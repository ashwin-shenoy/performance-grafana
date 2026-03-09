###############################################################################
# JMeter 5.6.3 — Standalone Runner Image
# Multi-platform (Java-based, runs on arm64 + amd64)
###############################################################################
FROM eclipse-temurin:17-jre

ARG JMETER_VERSION=5.6.3
ENV JMETER_HOME=/opt/jmeter
ENV PATH="${JMETER_HOME}/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends wget curl && rm -rf /var/lib/apt/lists/* && \
    wget -q "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz" \
         -O /tmp/jmeter.tgz && \
    tar -xzf /tmp/jmeter.tgz -C /opt && \
    mv /opt/apache-jmeter-${JMETER_VERSION} ${JMETER_HOME} && \
    rm /tmp/jmeter.tgz && \
    mkdir -p /jmeter/results

WORKDIR /jmeter

ENTRYPOINT ["jmeter"]
CMD ["-v"]
