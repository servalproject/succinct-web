#include <stdio.h>
#include <err.h>
#include <stdint.h>
#include <unistd.h>
#include <stdlib.h>
#include "fragment.h"
#include "message.h"

static uint8_t message[MSG_MAXLEN];

int main(int argc, char *argv[]) {
    if (argc != 4) {
        fprintf(stderr, "Usage: fragextract directory seq msgnum\n");
        return 2;
    }
    char *dir = argv[1];
    char *seqstr = argv[2];
    char *msg = argv[3];

    if (chdir(dir) != 0) err(1, "%s: chdir", dir);

    int64_t seq = parse_seq(seqstr);
    if (seq < 0) errx(1, "%s: invalid sequence number", seqstr);

    if (msg[0] == '\0') errx(1, "empty message number");
    char *msgend = NULL;
    long int n = strtol(msg, &msgend, 10);
    if (msgend[0] != '\0' || n <= 0 || n > FRAGMENT_MAX_MESSAGES) {
        errx(1, "%s: invalid message number", msg);
    }

    long length = fragments_extract_message(seq, n, message, NULL);
    if (!length) {
        errx(1, "could not extract message %s/%s", seqstr, msg);
    }

    fwrite(message, 1, length, stdout);
    return 0;
}
