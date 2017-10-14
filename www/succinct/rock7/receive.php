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

// log request

$req = [date('Y-m-d H:i:s O'), $_POST];
file_put_contents(Succinct::ROOT.'/log/rock7.log', json_encode($req)."\n", FILE_APPEND|LOCK_EX);

const MAX_DATA_LENGTH = 1000;
const MIN_FRAGMENT_SIZE = 13;

// require all _POST variables to be scalar
$postargs = array_filter($_POST, 'is_scalar');

if (count($postargs) != count($_POST)) {
    http_response_code(400);
    Succinct::loge(TAG, 'received non-scalar POST parameters');
    exit();
}

// of all the possible variables, these are the main ones we need
$filter = [
    'device_type' => FILTER_UNSAFE_RAW,
    'serial'      => ['filter'  => FILTER_VALIDATE_INT,
                      'options' => ['min_range' => 0, 'max_range' => PHP_INT_MAX]],
    'momsn'       => ['filter'  => FILTER_VALIDATE_INT,
                      'options' => ['min_range' => 0, 'max_range' => PHP_INT_MAX]],
    'trigger'     => FILTER_UNSAFE_RAW,
    'userData'    => ['filter'  => FILTER_VALIDATE_REGEXP,
                      'options' => ['regexp' => '/^(?:[0-9a-f][0-9a-f])+$/i']]
];

$args = filter_var_array($postargs, $filter);

$device_type = $args['device_type'];
$serial = $args['serial'];
$momsn = $args['momsn'];
$trigger = $args['trigger'];
$data = $args['userData'];

if ($device_type === null || $serial === null || $trigger === null) {
    http_response_code(400);
    Succinct::loge(TAG, 'missing/invalid POST parameters');
    exit();
}

// from here just return HTTP 200, subsequent errors are probably not Rock7's mistake

Succinct::logd(TAG, "received $trigger from $serial ($device_type; $momsn)");

// only process raw messages
if ($trigger != 'BLE_RAW') exit();

if ($data === null) {
    Succinct::loge(TAG, 'userData is invalid or absent');
    exit();
}

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

if (Succinct::team_is_finished($teamid))
    Succinct::logw(TAG, "received fragment for finished team $teamid");

Succinct::update_lastseen($teamid, 'rock', $user_key);

if (Succinct::place_fragment($tmp)) {
    Succinct::logd(TAG, "received fragment for team $teamid with seq $seq");
} else {
    Succinct::loge(TAG, "could not place fragment for team $teamid with seq $seq");
    unlink($tmp);
}

function data_to_fragment($data) {
    Succinct::logv(TAG, "data: $data");
    return hex2bin($data);
}
?>
