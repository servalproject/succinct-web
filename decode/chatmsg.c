#include <stdio.h>
#include <err.h>
#include <string.h>
#include <stdlib.h>
#include "message.h"

#define MAX_CHAT_MSG 600
static uint8_t buf[MAX_CHAT_MSG+1];

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: chatmsg sender epoch_ms\n");
        return 2;
    }
    char *sender_s = argv[1];
    char *epoch_s = argv[2];
    char *endptr = NULL;

    if (*sender_s == '\0') {
        errx(1, "empty sender number");
    }
    long int sender = strtol(sender_s, &endptr, 10);
    if (*endptr != '\0' || sender < 0 || sender > 255) {
        errx(1, "invalid sender number");
    }

    if (*epoch_s == '\0') {
        errx(1, "empty epoch");
    }
    long long int epoch = strtoll(epoch_s, &endptr, 10)/100;
    if (*endptr != '\0' || epoch < 0 || epoch > REL_EPOCH_MAX) {
        errx(1, "invalid epoch or out of range");
    }

    size_t bytes = fread(buf, 1, MAX_CHAT_MSG+1, stdin);
    if (ferror(stdin)) {
        err(1, "stdin");
    } else if (bytes == 0) {
        errx(1, "empty chat message from stdin");
    } else if (bytes > MAX_CHAT_MSG) {
        errx(1, "chat message exceeds set length limit (%d bytes)", MAX_CHAT_MSG);
    }
    buf[bytes] = '\0';
    if (strlen(buf) != bytes) {
        errx(1, "chat message contains null bytes");
    }

    message_t msg = new_chat_message(sender, epoch, buf);
    if (msg.info.type < 0) {
        errx(1, "error while constructing chat message (likely malformed utf8)");
    }

    if (!write_message(stdout, msg)) {
        errx(1, "could not write chat message");
    }

    return 0;
}
