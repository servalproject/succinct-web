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

    const WWW = self::ROOT . "/www";
    const LOGFILE = self::ROOT . "/log/succinct.log";

    const FRAGINFO = self::ROOT . '/decode/fraginfo';
    const PLACE_FRAGMENT = self::ROOT . '/decode/place_fragment';

    const SPOOL_DIR = self::ROOT . '/spool';
    const TMP_DIR = self::SPOOL_DIR . '/tmp';

    // below here is not configuration but is a useful place to put helper functions
    // and global initialisation code rather than including another file

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
