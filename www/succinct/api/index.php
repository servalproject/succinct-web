<?php
require('../../../config/succinct.php');

// don't exit even if connection closes
ignore_user_abort(true);

const TAG = 'Direct';
const MIN_FRAGMENT_SIZE = 13;
const MAX_FRAGMENT_SIZE = 65535;
const MAX_FORM_SIZE = 1048576;

if (!defined('Succinct::DIRECT_API_KEY')) {
    http_response_code(500);
    throw new Exception('DIRECT_API_KEY undefined');
}
if (!isset($_GET['key']) || $_GET['key'] !== Succinct::DIRECT_API_KEY) {
    http_response_code(403);
    Succinct::logi(TAG, 'API key not given or not accepted');
    exit();
}

if (!isset($_GET['api']) || $_GET['api'] !== 'v1') {
    http_response_code(400);
    Succinct::logi(TAG, 'rejecting unknown API version');
    exit();
}

$api = $_GET['api'];

if (!isset($_GET['cmd']) || !is_string($_GET['cmd']) || $_GET['cmd'] === '') {
    http_response_code(400);
    Succinct::logi(TAG, 'rejecting request without command');
    exit();
}

$cmd = $_GET['cmd'];

if (isset($_GET['args'])) {
    if (!is_string($_GET['args'])) {
        http_response_code(400);
        Succinct::logi(TAG, 'rejecting request with malformed args');
        exit();
    }
    $args = ($_GET['args'] === '') ? [] : explode('/', $_GET['args']);
} else {
    $args = [];
}

try {
    if ($cmd == 'uploadFragment') {
        API::uploadFragment($args);
    } else if ($cmd == 'ack') {
        API::ack($args);
    } else if ($cmd == 'receiveFragment') {
        API::receiveFragment($args);
    } else if ($cmd == 'haveForm') {
        API::haveForm($args);
    } else if ($cmd == 'uploadForm') {
        API::uploadForm($args);
    } else {
        $cmdstr = preg_match('#^[a-zA-Z0-9_-]+$#', $cmd) ? " ($cmd)" : "";
        throw new BadMethodCallException("unknown API command".$cmdstr);
    }
} catch (BadMethodCallException $e) {
    http_response_code(400);
    Succinct::logi(TAG, $e->getMessage());
    echo $e->getMessage();
    exit();
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    Succinct::logi(TAG, $e->getMessage());
    echo $e->getMessage();
    exit();
} catch (LengthException $e) {
    http_response_code(400);
    Succinct::logi(TAG, $e->getMessage());
    echo $e->getMessage();
    exit();
} catch (Exception $e) {
    http_response_code(500);
    Succinct::loge(TAG, $e->getMessage());
    exit();
}

class API {
    public static function uploadFragment($args) {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST')
            throw new BadMethodCallException('uploadFragment: must be a POST request');
        if (!isset($_SERVER['CONTENT_TYPE']) || $_SERVER['CONTENT_TYPE'] !== 'application/octet-stream')
            throw new BadMethodCallException('uploadFragment: wrong Content-Type specified');
        if (!isset($_SERVER['CONTENT_LENGTH']) || !preg_match('/^(?:0|[1-9][0-9]{0,9})$/', $_SERVER['CONTENT_LENGTH']))
            throw new BadMethodCallException('uploadFragment: a valid Content-Length must be specified');
        $length = (int) $_SERVER['CONTENT_LENGTH'];
        if ($length < MIN_FRAGMENT_SIZE || $length > MAX_FRAGMENT_SIZE)
            throw new LengthException('uploadFragment: specified Content-Length is out of valid bounds');
        if (count($args) != 1)
            throw new BadMethodCallException('wrong number of arguments to uploadFragment');
        if (!preg_match('/^[0-9a-f]{16}$/i', $args[0]))
            throw new InvalidArgumentException('bad teamid in uploadFragment');

        $teamid = strtolower($args[0]);
        // todo check if team is still valid to upload fragment to?

        $post = fopen('php://input', 'r');
        if (!$post) throw new Exception('uploadFragment: could not open POST input');

        $fragment = '';
        $remaining = $length + 1; // try to read one extra byte to ensure truth of Content-Length
        while (strlen($fragment) < $remaining && !feof($post)) {
            $extra = fread($post, min(8192, $remaining));
            if ($extra === FALSE)
                throw new Exception('uploadFragment: could not read POST input');
            if (strlen($extra) == 0 && stream_get_meta_data($post)['timed_out'])
                throw new Exception('uploadFragment: got timeout while waiting for POST input');

            $fragment .= $extra;
        }
        if (strlen($fragment) != $length)
            throw new LengthException('uploadFragment: received data length did not match Content-Length');

        fclose($post);

        $tmp = tempnam(Succinct::TMP_DIR, 'direct_fragment');
        if ($tmp === false) throw new Exception('could not create temporary file');

        if (file_put_contents($tmp, $fragment) === false) {
            unlink($tmp);
            throw new Exception("could not write to temporary file $tmp");
        }

        $fragment_teamid = Succinct::fraginfo($tmp, 'teamid');
        if ($fragment_teamid === false) {
            unlink($tmp);
            throw new Exception('could not decode teamid');
        }
        if ($teamid !== $fragment_teamid) {
            unlink($tmp);
            throw new InvalidArgumentException('uploadFragment: team id does not match fragment data');
        }
        $seq = Succinct::fraginfo($tmp, 'seq');
        if ($seq === false) {
            unlink($tmp);
            throw new Exception('could not decode seq');
        }

        if (Succinct::team_is_finished($teamid))
            Succinct::logw(TAG, "received fragment for finished team $teamid");

        Succinct::update_lastseen($teamid, 'http', $_SERVER['REMOTE_ADDR']);
        if (Succinct::place_fragment($tmp)) {
            Succinct::logd(TAG, "received fragment for team $teamid with seq $seq");
        } else {
            unlink($tmp);
            throw new Exception("could not place fragment for team $teamid with seq $seq");
        }

        if (!Succinct::rebuild_messages($teamid, $seq, false)) {
            throw new Exception("could not rebuild message $teamid/$seq");
        }

        print_ack($teamid);
    }

    public static function ack($args) {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET')
            throw new BadMethodCallException('ack must be a GET request');
        if (count($args) != 1)
            throw new BadMethodCallException('wrong number of arguments to ack');
        if (!preg_match('/^[0-9a-f]{16}$/i', $args[0]))
            throw new InvalidArgumentException('bad teamid in ack');
        $teamid = strtolower($args[0]);
        // todo check if team is still valid?

        Succinct::update_lastseen($teamid, 'http', $_SERVER['REMOTE_ADDR']);
        print_ack($teamid);
    }

    public static function receiveFragment($args) {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET')
            throw new BadMethodCallException('receiveFragment must be a GET request');
        if (count($args) != 2)
            throw new BadMethodCallException('wrong number of arguments to receiveFragment');
        if (!preg_match('/^[0-9a-f]{16}$/i', $args[0]))
            throw new InvalidArgumentException('bad teamid in receiveFragment');
        if (!preg_match('/^[0-9]{1,10}$/', $args[1]) || intval($args[1]) > 4294967295)
            throw new InvalidArgumentException('bad sequence number in receiveFragment');

        $team = strtolower($args[0]);
        $seq = sprintf('%010d', intval($args[1]));

        if (!is_dir(Succinct::SPOOL_DIR."/$team")) {
            Succinct::logw(TAG, "receiveFragment for unknown team: $team");
            http_response_code(404);
            return;
        }

        $queuedir = Succinct::SPOOL_DIR."/$team/queue";

        if (!silent_mkdir($queuedir))
            throw new Exception("receiveFragment: unable to make $team/queue directory");

        Succinct::update_lastseen($team, 'http', $_SERVER['REMOTE_ADDR']);

        $lastfile = "$queuedir/last";

        if (!file_exists($lastfile)) {
            $last = -1;
        } else {
            $last = trim(@file_get_contents($lastfile));
            if (!preg_match('/^[0-9]{10}$/', $last)) {
                $last = -1;
            }
        }

        $fragfile = "$queuedir/ready/$seq";

        if ($last == -1 || intval($seq) > intval($last) || !file_exists($fragfile)) {
            http_response_code(404);
        } else {
            Succinct::logi(TAG, "receiveFragment for $team/$seq");
            header('Content-Type: application/octet-stream');
            header('Content-Length: '.filesize($fragfile));
            if (!@readfile($fragfile)) {
                Succinct::loge(TAG, "receiveFragment: error while reading $fragfile: ".error_get_last()['message']);
                return;
            }
        }

        $lastreqfile = "$queuedir/lastreq";
        if (!file_exists($lastreqfile)) {
            $lastreq = -1;
        } else {
            $lastreq = trim(@file_get_contents($lastreqfile));
            if (!preg_match('/^[0-9]{10}$/', $lastreq)) {
                $lastreq = -1;
            }
        }

        if (intval($seq) > intval($lastreq) && intval($seq) <= intval($last)+1) {
            file_put_contents($lastreqfile, $seq);
        }
    }

    public static function haveForm($args) {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET')
            throw new BadMethodCallException('haveForm must be a GET request');
        if (count($args) != 1)
            throw new BadMethodCallException('wrong number of arguments to haveForm');
        if (!preg_match('/^[0-9a-f]{12}$/i', $args[0]))
            throw new InvalidArgumentException('bad form hash in haveForm');

        $hash = strtolower($args[0]);
        // FIXME implement
        echo 'false';
    }

    public static function uploadForm($args) {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST')
            throw new BadMethodCallException('uploadForm: must be a POST request');
        if (!isset($_SERVER['CONTENT_TYPE']) || $_SERVER['CONTENT_TYPE'] !== 'application/octet-stream')
            throw new BadMethodCallException('uploadForm: wrong Content-Type specified');
        if (!isset($_SERVER['CONTENT_LENGTH']) || !preg_match('/^(?:0|[1-9][0-9]{0,9})$/', $_SERVER['CONTENT_LENGTH']))
            throw new BadMethodCallException('uploadForm: a valid Content-Length must be specified');

        $length = (int) $_SERVER['CONTENT_LENGTH'];

        if ($length < 1 || $length > MAX_FORM_SIZE)
            throw new LengthException('uploadForm: specified Content-Length is out of valid bounds');
        if (count($args) != 1)
            throw new BadMethodCallException('wrong number of arguments to uploadForm');
        if (!preg_match('/^[0-9a-f]{12}$/i', $args[0]))
            throw new InvalidArgumentException('bad form hash in uploadForm');

        $hash = strtolower($args[0]);

        $post = fopen('php://input', 'r');
        if (!$post) throw new Exception('uploadForm: could not open POST input');

        $form = '';
        $remaining = $length + 1; // try to read one extra byte to ensure truth of Content-Length
        while (strlen($form) < $remaining && !feof($post)) {
            $extra = fread($post, min(8192, $remaining));
            if ($extra === FALSE)
                throw new Exception('uploadForm: could not read POST input');
            if (strlen($extra) == 0 && stream_get_meta_data($post)['timed_out'])
                throw new Exception('uploadForm: got timeout while waiting for POST input');

            $form .= $extra;
        }
        if (strlen($form) != $length)
            throw new LengthException('uploadForm: received data length did not match Content-Length');

        fclose($post);

        $tmp = tempnam(Succinct::TMP_DIR, 'direct_form');
        if ($tmp === false) throw new Exception('could not create temporary file');

        if (file_put_contents($tmp, $form) === false) {
            unlink($tmp);
            throw new Exception("could not write to temporary file $tmp");
        }

        // FIXME move form to correct place
    }
}

function print_ack($team) {
    $ackfile = Succinct::SPOOL_DIR.'/'.$team.'/ack';
    if (!file_exists($ackfile)) {
        http_response_code(404);
        return;
    }
    $ack = trim(file_get_contents($ackfile));
    if (preg_match('/^0+$/', $ack)) {
        $ack = 0;
    } else {
        $ack = preg_replace('/^0+/', '', $ack);
    }
    echo $ack;
}

function silent_mkdir($dir) {
    return (@mkdir($dir) || is_dir($dir));
}
?>
