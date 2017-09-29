CC=gcc
CFLAGS=-Wall -pedantic -std=gnu11

all: place_fragment fraginfo fragextract

place_fragment: decode.o fragment.o place_fragment.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fraginfo: fragment.o message.o fraginfo.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)

fragextract: fragment.o message.o fragextract.c
	$(CC) -o $@ $^ $(CFLAGS) $(CPPFLAGS)
