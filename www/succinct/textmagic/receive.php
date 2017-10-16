<?php
require('../../../config/succinct.php');

// don't exit even if connection closes
ignore_user_abort(true);

const TAG = 'TextMagic';

if (!defined('Succinct::TEXTMAGIC_CALLBACK_KEY')) {
    http_response_code(500);
    throw new Exception('TEXTMAGIC_CALLBACK_KEY undefined');
}
if (!isset($_GET['key']) || $_GET['key'] !== Succinct::TEXTMAGIC_CALLBACK_KEY) {
    http_response_code(403);
    Succinct::logi(TAG, 'callback key did not match');
    exit();
}

const MAX_TEXT_LENGTH = 1000;
const MIN_FRAGMENT_SIZE = 13;

$filter = [
    'id'          => ['filter'  => FILTER_UNSAFE_RAW,
                      'flags'   => FILTER_REQUIRE_SCALAR],
    'sender'      => ['filter'  => FILTER_VALIDATE_REGEXP,
                      'flags'   => FILTER_REQUIRE_SCALAR,
                      'options' => ['regexp' => '/^\d{1,15}$/']],
    'receiver'    => ['filter'  => FILTER_VALIDATE_REGEXP,
                      'flags'   => FILTER_REQUIRE_SCALAR,
                      'options' => ['regexp' => '/^\d{1,15}$/']],
    'messageTime' => ['filter'  => FILTER_VALIDATE_REGEXP,
                      'flags'   => FILTER_REQUIRE_SCALAR,
                      'options' => ['regexp' => '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d+\d{4}$/']],
    'text'        => ['filter'  => FILTER_UNSAFE_RAW,
                      'flags'   => FILTER_REQUIRE_SCALAR]
];

$args = filter_input_array(INPUT_POST, $filter);

$id = $args['id'];
$sender = $args['sender'];
$receiver = $args['receiver'];
$time = $args['messageTime'];
$text = $args['text'];

if ($id === null || $sender === null || $receiver === null || $text == null) {
    http_response_code(400);
    Succinct::loge(TAG, 'missing/invalid POST parameters');
    exit();
}

// from here just return HTTP 200, subsequent errors are probably not TextMagic's mistake
fastcgi_finish_request();

Succinct::logd(TAG, "received message $id from $sender on number $receiver");

if ($time === null) Succinct::logi(TAG, 'unexpected/missing messageTime');

if (strlen($text) > MAX_TEXT_LENGTH) {
    Succinct::logw(TAG, 'text message longer than limit');
    exit();
}

$fragment = text_to_fragment($text);
if ($fragment === false) {
    Succinct::logw(TAG, 'received non-base64 data');
    exit();
}

if (strlen($fragment) < MIN_FRAGMENT_SIZE) {
    Succinct::logw(TAG, 'received fragment too short');
    exit();
}

$tmp = tempnam(Succinct::TMP_DIR, 'textmagic_fragment');
if ($tmp === false) {
    Succinct::loge(TAG, 'could not create temporary file');
    exit();
}
if (file_put_contents($tmp, $fragment) === false) {
    Succinct::loge(TAG, "could not write to temporary file $tmp");
    unlink($tmp);
    exit();
}

$teamid = Succinct::fraginfo($tmp, 'teamid');
if ($teamid === false) {
    Succinct::loge(TAG, 'could not decode teamid from fragment');
    unlink($tmp);
    exit();
}

$seq = Succinct::fraginfo($tmp, 'seq');
if ($seq === false) {
    Succinct::loge(TAG, 'could not decode sequence number from fragment');
    unlink($tmp);
    exit();
}

if (Succinct::team_is_finished($teamid))
    Succinct::logw(TAG, "received fragment for finished team $teamid");

Succinct::update_lastseen($teamid, 'sms', $sender);

if (Succinct::place_fragment($tmp)) {
    Succinct::logd(TAG, "received fragment for team $teamid with seq $seq");
} else {
    Succinct::loge(TAG, "could not place fragment for team $teamid with seq $seq");
    unlink($tmp);
    exit();
}

if (!Succinct::rebuild_messages($teamid, $seq)) {
    Succinct::loge(TAG, "could not start process to rebuild messages for team $teamid seq $seq");
}

function text_to_fragment($text) {
    return base64_decode($text, true);
}
?>
