#ifndef MESSAGE_H
#define MESSAGE_H
#include <stdint.h>

#define MSG_TYPELEN 1
#define MSG_LENGTHLEN 2
#define MSG_HDRLEN (MSG_TYPELEN+MSG_LENGTHLEN)
#define MSG_MAX_PAYLOAD UINT16_MAX
#define MSG_MAXLEN (MSG_HDRLEN+MSG_MAX_PAYLOAD)

enum msg_type {
    TEAM_START = 0,
    TEAM_END = 1,
    MEMBER_JOIN = 2,
    MEMBER_PART = 3,
    LOCATION = 4,
    CHAT = 5,
    MAGPI_FORM = 6,
    MSG_TYPE_MAX = 255,
    MSG_TYPE_ERROR = -1
};

typedef struct msg_info {
    enum msg_type type;
    long length;
} msg_info;

/* type negative on error, length negative if header fragmented */
msg_info fragment_file_parse_message_header(FILE *fragment, long msg_offset);

/* number of messages started in this fragment, negative on error */
int fragment_file_messages_started(FILE *fragment);

/* negative on error */
long fragment_file_offset_nth_message(FILE *fragment, int n);

/* returns size of message including header, or 0 if error */
long fragments_extract_message(uint32_t seq, int n, uint8_t *buf, int *span);

#endif /* !MESSAGE_H */
