#include <sys/stat.h>
#include <err.h>
#include <errno.h>
#include "decode.h"

int mkdir_or_die(const char *path) {
    if (mkdir(path, 0777) == 0) {
        return 1;
    } else if (errno == EEXIST) {
        return 0;
    } else {
        err(1, "%s: mkdir", path);
    }
}
