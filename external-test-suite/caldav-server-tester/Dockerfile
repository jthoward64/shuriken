# caldav-server-tester: modern Python CalDAV conformance probe.
# https://github.com/python-caldav/caldav-server-tester  (AGPL-3.0)
FROM python:3.12-slim

# diffutils for the baseline diff in /lib/compare.sh; ca-certificates for pip.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends diffutils ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	# vobject is an optional runtime dep some checks need (it was dropped as a
	# hard dependency in caldav 2.0); install it so those checks don't abort.
	&& pip install --no-cache-dir caldav-server-tester vobject

WORKDIR /suite
# run.sh is provided via the bind mount (see docker-compose.yml).
CMD ["sh", "/suite/run.sh"]
