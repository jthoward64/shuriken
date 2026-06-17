# python-caldav functional test suite — drives the real python-caldav client
# library against the server. https://github.com/python-caldav/caldav (GPL-3.0)
FROM python:3.12-slim

# Pin a release for reproducible results; override with --build-arg CALDAV_REF=...
ARG CALDAV_REF=v3.2.1

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git diffutils ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& git clone --depth 1 --branch "${CALDAV_REF}" \
		https://github.com/python-caldav/caldav.git /caldav

WORKDIR /caldav
# Install the library plus its test extras; fall back to an explicit dep set if
# the optional extra group isn't present in this tag.
RUN pip install --no-cache-dir -e ".[test]" \
	|| pip install --no-cache-dir -e . pytest pyyaml icalendar vobject \
		recurring-ical-events lxml requests tzlocal

# The test extras pull in radicale + xandikos, which the harness auto-runs as
# in-process comparison servers — tripling runtime and adding non-shuriken
# results. We only want to test shuriken. Uninstall them so conftest can't spin
# them up (the embedded-server fixtures are guarded imports, so collection still
# works); `--update-baseline` of caldav_test_servers.yaml also disables them, but
# removing the packages is what actually stops them running.
RUN pip uninstall -y radicale xandikos || true

# run.sh is provided via the bind mount (see docker-compose.yml).
CMD ["sh", "/suite/run.sh"]
