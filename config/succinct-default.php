<?php
class Succinct {
    // TextMagic callback URLs take a parameter key=...
    // this ensures that only TextMagic servers can send data through that interface
    // if left as default, randomly generated in update-config.sh
    const TEXTMAGIC_CALLBACK_KEY = '_TEXTMAGIC_CALLBACK_KEY_';

    // Rock callback URLs take a parameter key=...
    // this ensures that only Rock servers can send data through that interface
    // if left as default, randomly generated in update-config.sh
    const ROCK_CALLBACK_KEY = '_ROCK_CALLBACK_KEY_';

    // key for direct API access
    const DIRECT_API_KEY = '_DIRECT_API_KEY_';

    // Can set to e.g. Australia/Adelaide or UTC
    const TIMEZONE = 'UTC';

    // Directory containing succinct files (e.g. www, config, ...)
    // if left as default, will be generated in update-config.sh
    const ROOT = '_SUCCINCT_HOME_';

    // MySQL/MariaDB config
    const MYSQL_HOST = 'localhost';
    const MYSQL_USER = 'ramp';
    const MYSQL_PASS = null;
    const MYSQL_BASE = 'ramp';

    const WWW = self::ROOT . "/www";
    const LOGFILE = self::ROOT . "/log/succinct.log";

    const FRAGINFO = self::ROOT . '/decode/fraginfo';
    const PLACE_FRAGMENT = self::ROOT . '/decode/place_fragment';
    const REBUILD_MESSAGES = self::ROOT . '/decode/rebuild_messages';
    const SEND_ROCK = self::ROOT . '/decode/send_rock';
    const SMAC = self::ROOT . '/smac/smac';

    const SPOOL_DIR = self::ROOT . '/spool';
    const TMP_DIR = self::SPOOL_DIR . '/tmp';

    const MAGPI_FORMS_DIR = self::SPOOL_DIR . '/magpi';

    // below here is not configuration but is a useful place to put helper functions
    // and global initialisation code rather than including another file

    private static $mysqli = false;

    public static function fraginfo($file, $infotype) {
        if (strlen($file) == 0 || strlen($infotype) == 0) return false;
        $cmd = escapeshellarg(self::FRAGINFO).' '.escapeshellarg($infotype).' '.escapeshellarg($file).' 2>/dev/null';
        $out = exec($cmd, $outa, $ret);
        if ($ret != 0) {
            return false;
        }
        return $out;
    }

    public static function place_fragment($file) {
        if (strlen($file) == 0) return false;
        $cmd = escapeshellarg(self::PLACE_FRAGMENT).' '.escapeshellarg($file).' '.escapeshellarg(self::SPOOL_DIR);
        $out = exec($cmd, $outa, $ret);
        return ($ret == 0);
    }

    public static function rebuild_messages($team, $seq, $background = true) {
        if (strlen($team) == '' || strlen($seq) == '') return false;
        $cmd = 'cd '.escapeshellcmd(dirname(self::REBUILD_MESSAGES))
            .' && '.escapeshellcmd(self::REBUILD_MESSAGES).' '.escapeshellcmd(self::SPOOL_DIR)
            .' '.escapeshellarg($team).' '.escapeshellarg($seq)
            .' >> '.escapeshellarg(self::ROOT . '/log/rebuild.log').' 2>&1';
        if ($background) {
            $cmd .= ' &';
        }
        $out = exec($cmd, $outa, $ret);
        return ($ret == 0);
    }

    public static function send_rock($team, $rockid, $background = true) {
        if (strlen($team) == '' || strlen($rockid) == '') return false;

        $cmd = 'cd '.escapeshellcmd(dirname(self::SEND_ROCK))
            .' && '.escapeshellcmd(self::SEND_ROCK).' '.escapeshellcmd(self::SPOOL_DIR)
            .' '.escapeshellarg($team)
            .' >> '.escapeshellarg(self::ROOT . '/log/send_rock.log').' 2>&1';
        if ($background) {
            $cmd .= ' &';
        }
        $out = exec($cmd, $outa, $ret);
        return ($ret == 0);
    }

    public static function install_magpi_recipe($hash, $tmpfile) {
        $tmpdir = "$tmpfile.outdir";
        if (!mkdir($tmpdir))
            return false; // throw new Exception('install_magpi_recipe: mkdir failed');

        $cmd = 'cd '.escapeshellarg(dirname(self::SMAC))
            .' && '.escapeshellarg(self::SMAC).' recipe xhcreate'
            .' '.escapeshellarg($tmpdir).' '.escapeshellarg($tmpfile)
            .' >> '.escapeshellarg(self::ROOT . '/log/smac.log').' 2>&1';

        $out = exec($cmd, $outa, $ret);
        if ($ret != 0) {
            shell_exec('rm -rf '.escapeshellarg($tmpdir));
            return false;
        }

        $entries = scandir($tmpdir);
        if ($entries === false) {
            shell_exec('rm -rf '.escapeshellarg($tmpdir));
            return false; // throw new Exception('install_magpi_recipe: could not read temporary directory');
        }
        $files = array_diff($entries, ['.', '..']);

        if (count($files) != 2) {
            shell_exec('rm -rf '.escapeshellarg($tmpdir));
            return false; // throw new Exception('install_magpi_recipe: expected two files in magpi recipe output');
        }

        // Since the result should be deterministic, I don't think we care about race conditions here

        // TODO cleanup if any of these renames fail?
        foreach ($files as $filename) {
            if (!rename("$tmpdir/$filename", self::MAGPI_FORMS_DIR . "/recipe/$filename")
                return false;
        }
        return rename($tmpfile, self::MAGPI_FORMS_DIR . "/form/$hash");
    }

    private static function db_connect() {
        if (self::$mysqli) return true;
        self::$mysqli = new mysqli(self::MYSQL_HOST, self::MYSQL_USER, self::MYSQL_PASS, self::MYSQL_BASE);
        if (self::$mysqli->connect_errno) {
            self::loge('Succinct', 'db_connect: MySQL connection error '.self::$mysqli->connect_error);
            self::$mysqli = false;
            return false;
        }
        return true;
    }

    public static function team_is_finished($team) {
        if (!self::db_connect()) return false;

        $team_esc = self::$mysqli->real_escape_string($team);
        $res = self::$mysqli->query("SELECT id FROM teams WHERE teamid = '$team_esc' AND finished IS NOT NULL");
        if (!$res) {
            self::loge('Succinct', "team_is_finished: MySQL query error ".self::$mysqli->error);
            return false;
        }
        $rows = $res->num_rows;
        $res->free();
        return ($rows > 0);
    }

    public static function update_lastseen($team, $method, $sender) {
        $methods = ['rock' => 'id', 'sms' => 'sender', 'http' => 'ip'];
        if (!isset($methods[$method]))
            throw new Exception('update_lastseen: unknown method');

        if (!self::db_connect()) return false;

        $senderkey = 'lastseen_'.$method.'_'.$methods[$method];
        $timekey = 'lastseen_'.$method.'_time';
        $sender_esc = self::$mysqli->real_escape_string($sender);
        $team_esc = self::$mysqli->real_escape_string($team);
        $sql = "INSERT INTO teams (teamid, $senderkey, $timekey) VALUES ('$team_esc', '$sender_esc', NOW())"
            ." ON DUPLICATE KEY UPDATE $senderkey='$sender_esc', $timekey=NOW()";
        $res = self::$mysqli->query($sql);
        if (!$res) {
            self::loge('Succinct', "update_lastseen: MySQL query error ".self::$mysqli->error);
            return false;
        }
        if (self::$mysqli->affected_rows == 1) {
            self::logd('Succinct', "update_lastseen: inserted new team $team (".self::$mysqli->insert_id.") from $method message");
        }
        $res->free();
        return true;
    }

    // Return the active rock unit for a team,
    // but only if the rock unit has been seen more recently than either SMS or HTTP
    public static function team_active_rock($team) {
        if (!self::db_connect()) return false;

        $team_esc = self::$mysqli->real_escape_string($team);
        $sql = "SELECT lastseen_rock_id "
              ."FROM teams "
              ."WHERE teamid = $team_esc "
              ."AND lastseen_rock_time > lastseen_http_time "
              ."AND lastseen_rock_time > lastseen_sms_time ";
        $res = self::$mysqli->query($sql);
        if (!$res) {
            self::loge('Succinct', "get_active_rock: MySQL query error ".self::$mysqli->error);
            return false;
        }
        $ret = false;
        if ($row = $res->fetch_assoc()) {
            $ret = $row["lastseen_rock_id"];
        }
        $res->free();
        return $ret;
    }

    private static function log($tag, $msg, $level) {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
        $caller = $trace[1];
        $tracestr = "{$caller['file']}:{$caller['line']}";
        $line = "[$tag/$level ".date('Y-m-d H:i:s O')." {$_SERVER['REMOTE_ADDR']}] ($tracestr) $msg\n";
        file_put_contents(self::LOGFILE, $line, FILE_APPEND);
    }

    public static function logv($tag, $msg) { return self::log($tag, $msg, 'Verbose'); }
    public static function logd($tag, $msg) { return self::log($tag, $msg, 'Debug  '); }
    public static function logi($tag, $msg) { return self::log($tag, $msg, 'Info   '); }
    public static function logw($tag, $msg) { return self::log($tag, $msg, 'Warning'); }
    public static function loge($tag, $msg) { return self::log($tag, $msg, 'Error  '); }
}

if (basename(__FILE__) == 'succinct-default.php') {
    throw new Error("succinct-default.php not intended to be included directly");
}

// set up PHP options
ini_set('display_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set(Succinct::TIMEZONE);
?>
