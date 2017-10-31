#include <stdio.h>
#include <err.h>
#include <string.h>
#include <stdlib.h>
#include "message.h"

#define MAX_CHAT_MSG 600

static uint8_t msgbuf[MSG_MAX_PAYLOAD+1];

void print_usage(void);
int write_chat_msg(char *member, char *epoch, char *msg);
int write_raw_msg(char *type, char *filename);

int main(int argc, char *argv[]) {
    if (argc < 2) print_usage();
    char *type = argv[1];
    if (strcmp(type, "start") == 0 || strcmp(type, "end") == 0
            || strcmp(type, "join") == 0 || strcmp(type, "part") == 0
            || strcmp(type, "locations") == 0) {
        errx(1, "%s: not implemented yet", type);
    } else if (strcmp(type, "chat") == 0) {
        if (argc != 5) print_usage();
        return write_chat_msg(argv[2], argv[3], argv[4]);
    } else if (strcmp(type, "raw") == 0) {
        if (argc != 4) print_usage();
        return write_raw_msg(argv[2], argv[3]);
    } else {
        errx(1, "%s: unknown type", type);
    }
}

void print_usage(void) {
    fprintf(stderr, "Usage:\n"
                    "  msgwrite start name time_ms\n"
                    "  msgwrite end time_ms\n"
                    "  msgwrite join member_pos epoch_ms name id\n"
                    "  msgwrite part member_pos epoch_ms\n"
                    "  msgwrite locations [member_pos epoch_ms lat lng acc]+\n"
                    "  msgwrite chat member_pos epoch_ms msg\n"
                    "  msgwrite raw type datafile\n");
    exit(2);
}

int write_chat_msg(char *member, char *epoch_s, char *message) {
    char *endptr = NULL;

    if (*member == '\0') {
        errx(1, "empty sender number");
    }
    long int sender = strtol(member, &endptr, 10);
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

    int len = strlen(message);
    if (len == 0) {
        errx(1, "empty chat message from stdin");
    } else if (len > MAX_CHAT_MSG) {
        errx(1, "chat message exceeds set length limit (%d bytes)", MAX_CHAT_MSG);
    }

    message_t msg = new_chat_message(sender, epoch, message);
    if (msg.info.type < 0) {
        errx(1, "error while constructing chat message (likely malformed utf8)");
    }

    if (!write_message(stdout, msg)) {
        errx(1, "could not write chat message");
    }

    return 0;
}

int write_raw_msg(char *type, char *filename) {
    if (*type == '\0') {
        errx(1, "empty type");
    } else if (*filename == '\0') {
        errx(1, "empty filename");
    }
    char *endptr;
    long int t = strtol(type, &endptr, 10);
    if (*endptr != '\0' || t < 0 || t > MSG_TYPE_MAX) {
        errx(1, "invalid type");
    }

    FILE *msgfile = fopen(filename, "r");
    if (!msgfile) err(1, "%s", filename);

    size_t payload = fread(msgbuf, 1, MSG_MAX_PAYLOAD+1, msgfile);
    if (ferror(msgfile)) err(1, "%s", filename);
    if (payload == 0) warnx("warning: %s: message has zero length", filename);
    if (payload > MSG_MAX_PAYLOAD) errx(1, "%s: message too long", filename);

    if (!write_message_raw(stdout, t, msgbuf, payload)) {
        errx(1, "could not write raw message");
    }

    return 0;
}
