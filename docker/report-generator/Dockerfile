###############################################################################
# Report Generator Image
# Generates HTML reports from JTL files and optionally uploads to S3
###############################################################################
FROM eclipse-temurin:17-jre-jammy

ARG JMETER_VERSION=5.6.3

ENV JMETER_HOME=/opt/jmeter/apache-jmeter \
    PATH="${PATH}:/opt/jmeter/apache-jmeter/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        unzip \
        bash \
        python3 \
        python3-pip \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install JMeter (needed for report generation CLI)
RUN mkdir -p /opt/jmeter && \
    curl -fsSL https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz \
    | tar xz -C /opt/jmeter && \
    mv /opt/jmeter/apache-jmeter-${JMETER_VERSION} ${JMETER_HOME}

# Install AWS CLI for optional S3 upload
RUN pip3 install --no-cache-dir awscli 2>/dev/null || true

COPY generate-report.sh /opt/jmeter/generate-report.sh

RUN mkdir -p /report /results && \
    chmod -R 775 /opt/jmeter /report /results && \
    chgrp -R 0 /opt/jmeter /report /results && \
    chmod -R g=u /opt/jmeter /report /results

RUN useradd -u 1001 -g 0 -d /opt/jmeter -s /bin/bash jmeter
USER 1001

ENTRYPOINT ["/bin/bash", "/opt/jmeter/generate-report.sh"]
