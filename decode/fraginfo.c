#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <err.h>
#include "fragment.h"
#include "message.h"

enum infomode {
    TEAM_ID,
    SEQ_NUM,
    RAW_OFFSET,
    MSG_STARTS,
    MSG_SPAN,
    MODE_UNKNOWN = -1
};

static enum infomode getmode(const char *mode, int argc);
static void print_usage(FILE *out);

int main(int argc, char *argv[]) {
    enum infomode mode = MODE_UNKNOWN;
    if (argc >= 2) {
        mode = getmode(argv[1], argc);
    }
    if (mode == MODE_UNKNOWN) {
        print_usage(stderr);
        return 2;
    }

    if (mode == TEAM_ID) {
        char *filename = argv[2];
        FILE *fp = fopen(filename, "r");
        if (!fp) err(1, "%s: open", filename);
        char *team = fragment_file_read_teamid_hex(fp);
        if (!team) return 1;
        printf("%s\n", team);
        free(team);
        return 0;
    }

    if (mode == SEQ_NUM) {
        char *filename = argv[2];
        FILE *fp = fopen(filename, "r");
        if (!fp) err(1, "%s: open", filename);
        int64_t seq = fragment_file_read_seq(fp);
        if (seq < 0) return 1;
        char *seqf = format_seq(seq);
        if (!seqf) return 1;
        printf("%s\n", seqf);
        free(seqf);
        return 0;
    }
    
    if (mode == RAW_OFFSET) {
        char *filename = argv[2];
        FILE *fp = fopen(filename, "r");
        if (!fp) err(1, "%s: open", filename);
        int offset = fragment_file_read_raw_offset(fp);
        if (offset < 0) return 1;
        printf("%d\n", offset);
        return 0;
    }

    if (mode == MSG_STARTS) {
        char *filename = argv[2];
        FILE *fp = fopen(filename, "r");
        if (!fp) err(1, "%s: open", filename);
        int started = fragment_file_messages_started(fp);
        if (started < 0) return 1;
        printf("%d\n", started);
        return 0;
    }

    if (mode == MSG_SPAN) {
        char *dir = argv[2];
        if (chdir(dir) != 0) err(1, "%s: chdir", dir);

        int64_t seq = parse_seq(argv[3]);
        if (seq < 0) err(1, "%s: invalid sequence number", argv[3]);

        if (argv[4][0] == '\0') errx(1, "empty message number");
        char *msgend = NULL;
        long int n = strtol(argv[4], &msgend, 10);
        if (msgend[0] != '\0' || n <= 0 || n > FRAGMENT_MAX_MESSAGES) {
            errx(1, "%s: invalid message number", argv[4]);
        }

        int span;
        if (!fragments_extract_message(seq, n, NULL, &span)) {
            errx(1, "could not parse message %d", (int) n);
        }
        printf("%d\n", span);

        return 0;
    }
}

static enum infomode getmode(const char *mode, int argc) {
    if (strcmp(mode, "teamid") == 0 && argc == 3) return TEAM_ID;
    if (strcmp(mode, "seq") == 0 && argc == 3) return SEQ_NUM;
    if (strcmp(mode, "rawoffset") == 0 && argc == 3) return RAW_OFFSET;
    if (strcmp(mode, "msgstarts") == 0 && argc == 3) return MSG_STARTS;
    if (strcmp(mode, "msgspan") == 0 && argc == 5) return MSG_SPAN;
    return MODE_UNKNOWN;
}

static void print_usage(FILE *out) {
    fprintf(out, "Usage:\n"
                 "  fraginfo teamid file\n"
                 "  fraginfo seq file\n"
                 "  fraginfo rawoffset file\n"
                 "  fraginfo msgstarts file\n"
                 "  fraginfo msgspan directory seq msgnum\n");
}
