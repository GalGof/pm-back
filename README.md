QA automation tool

pack - collection of docker images with descriptions how to deploy them
deploy required pack on specified host (by name | label)
basically create test stand for || autotests
*optionally for manual usage

requirements:
* "autotests must go on"
always up - no errors shall crush it.

* connects to multiple hosts with docker (http | ssh (unix socket))

* each hosts may have multiple network interfaces

* connected host up/down/edit/add/delete on fly

* maintenance mode. for registry maintenance cleanup. (no new deployments, new packs)

* json description for pack creations

* json description for pack deployment

* deploy container params overrides

* update deployed pack

* monitor dumps

* collect various data on demand(logs, dumps & etc)

* optional sniffer for pack components

* global shared resources (docker images with bin data that can be connected to deployed pack)

* * not supposed to be secured per se, just protection from accidental "tremored hands"
