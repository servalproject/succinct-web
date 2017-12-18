CC=gcc
CFLAGS=-Wall -pedantic -std=gnu11

all: place_fragment fraginfo fragwrite msgwrite process_fragment

place_fragment: decode.o fragment.o place_fragment.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fraginfo: fragment.o message.o ccan/json/json.o fraginfo.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fragwrite: fragment.o message.o ccan/json/json.o fragwrite.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

msgwrite: message.o ccan/json/json.o fragment.o msgwrite.c
	$(CC) -o $@ $^ $(CLFAGS) $(CPPFLAGS)

process_fragment: message.o ccan/json/json.o fragment.o process_fragment.c
	$(CC) -o $@ $^ $(CLFAGS) $(CPPFLAGS)
