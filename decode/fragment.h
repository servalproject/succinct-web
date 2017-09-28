#ifndef FRAGMENT_H
#define FRAGMENT_H

#include <stdint.h>

#define TEAMLEN 8
#define SEQLEN 4
#define OFFSETLEN 1
#define FRAGHDRLEN (TEAMLEN + SEQLEN + OFFSETLEN)
#define FRAGMENT_MAX_MESSAGES 99999

/* NULL on error, should be free'd after use */
char *fragment_file_read_teamid_hex(FILE *fragment);

/* negative on error, uint32_t value on success */
int64_t fragment_file_read_seq(FILE *fragment);

/* negative on error, uint8_t value on success */
int fragment_file_read_raw_offset(FILE *fragment);

/* offset of first message start, 0 if no start of message, -1 on error */
long fragment_file_first_message_offset(FILE *fragment);

/* NULL on error, should be free'd after use. Padded on left with 0s. */
char *format_seq(int64_t seq);

#endif /* !FRAGMENT_H */
