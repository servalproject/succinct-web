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

typedef uint64_t abs_epoch;
typedef uint32_t rel_epoch;
typedef uint8_t member_pos;

typedef struct member_location {
    member_pos member;
    rel_epoch time;
    float lat;
    float lng;
    int acc; /* in metres, -1 indicates over 1000m */
} member_location;

struct message_team_start {
    abs_epoch time;
    char *name;
};

struct message_team_end {
    abs_epoch time;
};

struct message_member_join {
    member_pos member;
    rel_epoch time;
    char *name;
    char *id;
};

struct message_member_part {
    member_pos member;
    rel_epoch time;
};

struct message_location {
    unsigned int length;
    member_location *locations;
};

struct message_chat {
    member_pos member;
    rel_epoch time;
    char *message;
};

struct message_magpi_form {
    member_pos member;
    rel_epoch time;
    unsigned int length;
    uint8_t *data;
};

typedef struct message {
    msg_info info;
    union {
        struct message_team_start  team_start;
        struct message_team_end    team_end;
        struct message_member_join member_join;
        struct message_member_part member_part;
        struct message_location    location;
        struct message_chat        chat;
        struct message_magpi_form  magpi_form;
    } data;
} message_t;

/* type negative on error, length negative if header fragmented */
msg_info fragment_file_parse_message_header(FILE *fragment, long msg_offset);

/* number of messages started in this fragment, negative on error */
int fragment_file_messages_started(FILE *fragment);

/* negative on error */
long fragment_file_offset_nth_message(FILE *fragment, int n);

/* returns size of message including header, or 0 if error */
long fragments_extract_message(uint32_t seq, int n, uint8_t *buf, int *span);

/* (result).info.type negative on error */
message_t parse_message(uint8_t *buf, unsigned int len);

/* free any memory associated with msg */
void free_message(message_t msg);

#endif /* !MESSAGE_H */
