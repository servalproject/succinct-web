#include <stdio.h>
#include <err.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdlib.h>
#include "fragment.h"
#include "decode.h"

int main(int argc, char *argv[]) {
    if (argc != 3 || (argc > 1 && argv[1][0] == '-')) {
        fprintf(stderr, "Usage: place_fragment fragment dir\n");
        return 2;
    }
    char *filename = argv[1];
    char *directory = argv[2];

    FILE *fp = fopen(filename, "r");
    if (!fp) err(1, "%s: open", filename);

    if (fseek(fp, 0, SEEK_END) != 0) err(1, "%s: fseek", filename);

    long filesize = ftell(fp);

    if (filesize <= TEAMLEN + SEQLEN + OFFSETLEN) {
        errx(1, "%s: too small to be valid fragment", filename);
    }

    int cwdfd = open(".", O_DIRECTORY);
    if (cwdfd < 0) err(1, ".");

    if (chdir(directory) != 0) err(1, "%s: chdir", directory);

    char *team = fragment_file_read_teamid_hex(fp);
    if (!team) errx(1, "%s: could not read team ID", filename);

    int64_t seq = fragment_file_read_seq(fp);
    if (seq < 0) errx(1, "%s: could not read sequence number", filename);

    int raw = fragment_file_read_raw_offset(fp);
    if (raw < 0) errx(1, "%s: could not read offset", filename);

    long firstoff = fragment_file_first_message_offset(fp);
    if (firstoff < 0) errx(1, "%s: could not check next message offset", filename);

    char *seqstr = format_seq(seq);
    if (!seqstr) errx(1, "could not format sequence number");

    fprintf(stderr, "team: %s\n", team);
    fprintf(stderr, "seq: %s\n", seqstr);
    fprintf(stderr, "raw offset: %d\n", raw);
    if (firstoff == 0) {
        fprintf(stderr, "offset of next message: (no next message)\n");
    } else {
        fprintf(stderr, "offset of next message: %ld\n", firstoff);
    }

    mkdir_or_die(team);

    char fragmentdir[sizeof(team)+strlen("/fragments")];
    sprintf(fragmentdir, "%s/fragments", team);

    mkdir_or_die(fragmentdir);

    char newdir[sizeof(fragmentdir)+strlen("/new")];
    sprintf(newdir, "%s/new", fragmentdir);

    mkdir_or_die(newdir);

    char fragment[sizeof(newdir)+1+strlen(seqstr)];
    sprintf(fragment, "%s/%s", newdir, seqstr);

    if (renameat(cwdfd, filename, AT_FDCWD, fragment) != 0) {
        err(1, "%s: move", fragment);
    }

    puts(fragment);

    free(team);
    free(seqstr);

    return 0;
}
