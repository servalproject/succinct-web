<?php
require('../../../config/succinct.php');

// don't exit even if connection closes
ignore_user_abort(true);

const TAG = 'Rock7';

if (!defined('Succinct::ROCK_CALLBACK_KEY')) {
    http_response_code(500);
    throw new Exception('ROCK_CALLBACK_KEY undefined');
}
if (!isset($_GET['key']) || $_GET['key'] !== Succinct::ROCK_CALLBACK_KEY) {
    http_response_code(403);
    Succinct::logi(TAG, 'callback key did not match');
    exit();
}

const MAX_DATA_LENGTH = 1000;
const MIN_FRAGMENT_SIZE = 13;

$filter = [
    'ref'         => ['filter'  => FILTER_UNSAFE_RAW,
                      'flags'   => FILTER_REQUIRE_SCALAR],
    'userKey'     => ['filter'  => FILTER_UNSAFE_RAW,
                      'flags'   => FILTER_REQUIRE_SCALAR],
    'transmitTime'=> ['filter'  => FILTER_VALIDATE_REGEXP,
                      'flags'   => FILTER_REQUIRE_SCALAR,
                      'options' => ['regexp' => '/^\d{8}T\d{6}Z$/']],
    'data'        => ['filter'  => FILTER_UNSAFE_RAW,
                      'flags'   => FILTER_REQUIRE_SCALAR]
];

$args = filter_input_array(INPUT_POST, $filter);

$ref = $args['ref'];
$user_key = $args['userKey'];
$time = $args['transmitTime'];
$data = $args['data'];

if ($ref === null || $user_key === null || $data == null) {
    http_response_code(400);
    Succinct::loge(TAG, 'missing/invalid POST parameters');
    exit();
}

// from here just return HTTP 200, subsequent errors are probably not TextMagic's mistake

Succinct::logd(TAG, "received message $ref from $user_key");

if ($time === null) Succinct::logi(TAG, 'unexpected/missing transmitTime');

if (strlen($data) > MAX_DATA_LENGTH) {
    Succinct::logw(TAG, 'data longer than limit');
    exit();
}

$fragment = data_to_fragment($data);
if ($fragment === false) {
    Succinct::logw(TAG, 'received invalid data');
    exit();
}

if (strlen($fragment) < MIN_FRAGMENT_SIZE) {
    Succinct::logw(TAG, 'received fragment too short');
    exit();
}

$tmp = tempnam(Succinct::TMP_DIR, 'rock7_fragment');
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

if (Succinct::place_fragment($tmp)) {
    Succinct::logd(TAG, "received fragment for team $teamid with seq $seq");
} else {
    Succinct::loge(TAG, "could not place fragment for team $teamid with seq $seq");
    unlink($tmp);
}

function data_to_fragment($data) {
    Succinct::logv(TAG, "data: $data");
    // todo decode properly, documentation just says hex-encoded but that could be any number of things
    return $data;
}
?>
