###############################################################################
# JMeter Base Image — OpenShift Compatible
# Runs as non-root (UID 1001) for SCC compliance
# Includes: JMeter 5.6.3, Plugin Manager, Jolokia, Telegraf agent
###############################################################################
FROM eclipse-temurin:17-jre-jammy AS base

ARG JMETER_VERSION=5.6.3
ARG JMETER_PLUGINS_MANAGER_VERSION=1.10
ARG CMDRUNNER_VERSION=2.3
ARG JOLOKIA_VERSION=1.7.2
ARG TELEGRAF_VERSION=1.28.5

ENV JMETER_HOME=/opt/jmeter/apache-jmeter \
    JMETER_BIN=/opt/jmeter/apache-jmeter/bin \
    JMETER_LIB=/opt/jmeter/apache-jmeter/lib \
    PATH="${PATH}:/opt/jmeter/apache-jmeter/bin"

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        unzip \
        bash \
        net-tools \
        iproute2 \
        procps \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install JMeter
RUN mkdir -p /opt/jmeter && \
    curl -fsSL https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz \
    | tar xz -C /opt/jmeter && \
    mv /opt/jmeter/apache-jmeter-${JMETER_VERSION} ${JMETER_HOME}

# Install JMeter Plugin Manager + CMD Runner
RUN curl -fsSL -o ${JMETER_LIB}/ext/jmeter-plugins-manager-${JMETER_PLUGINS_MANAGER_VERSION}.jar \
        https://jmeter-plugins.org/get/ && \
    curl -fsSL -o ${JMETER_LIB}/cmdrunner-${CMDRUNNER_VERSION}.jar \
        https://repo1.maven.org/maven2/kg/apc/cmdrunner/${CMDRUNNER_VERSION}/cmdrunner-${CMDRUNNER_VERSION}.jar && \
    java -cp ${JMETER_LIB}/ext/jmeter-plugins-manager-${JMETER_PLUGINS_MANAGER_VERSION}.jar \
        org.jmeterplugins.repository.PluginManagerCMDInstaller

# Install Jolokia JVM agent for JVM metrics exposure
RUN curl -fsSL -o ${JMETER_LIB}/jolokia-java-agent.jar \
        https://repo1.maven.org/maven2/org/jolokia/jolokia-jvm/${JOLOKIA_VERSION}/jolokia-jvm-${JOLOKIA_VERSION}.jar

# Install Telegraf for sidecar metrics collection
RUN curl -fsSL https://dl.influxdata.com/telegraf/releases/telegraf-${TELEGRAF_VERSION}_linux_amd64.tar.gz \
    | tar xz --strip-components=2 -C /usr/local/bin \
        telegraf-${TELEGRAF_VERSION}/usr/bin/telegraf

# Create directories with open permissions for OpenShift arbitrary UID
RUN mkdir -p /opt/jmeter/scripts /opt/jmeter/scenarios /report /tmp/jmeter && \
    chmod -R 775 /opt/jmeter /report /tmp/jmeter && \
    chgrp -R 0 /opt/jmeter /report /tmp/jmeter && \
    chmod -R g=u /opt/jmeter /report /tmp/jmeter

# OpenShift runs containers with arbitrary UIDs in root group (GID 0)
# Do NOT hardcode USER — let OpenShift assign UID dynamically
# Set a non-root default for vanilla Kubernetes
RUN useradd -u 1001 -g 0 -d /opt/jmeter -s /bin/bash jmeter
USER 1001

WORKDIR /opt/jmeter

EXPOSE 1099 50000 4445 8778

ENTRYPOINT ["/bin/bash"]
