###############################################################################
# JMeter Base Image — OpenShift Compatible
# Non-root, GID 0 writable, Jolokia + Plugin Manager + Telegraf
###############################################################################
FROM eclipse-temurin:17-jre-jammy

ARG JMETER_VERSION=5.6.3
ARG JMETER_PLUGINS_MANAGER_VERSION=1.10
ARG CMDRUNNER_VERSION=2.3
ARG JOLOKIA_VERSION=1.7.2

ENV JMETER_HOME=/opt/jmeter/apache-jmeter \
    PATH="${PATH}:/opt/jmeter/apache-jmeter/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl unzip bash net-tools iproute2 procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/jmeter && \
    curl -fsSL https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz \
    | tar xz -C /opt/jmeter && \
    mv /opt/jmeter/apache-jmeter-${JMETER_VERSION} ${JMETER_HOME}

RUN curl -fsSL -o ${JMETER_HOME}/lib/ext/jmeter-plugins-manager-${JMETER_PLUGINS_MANAGER_VERSION}.jar \
        https://jmeter-plugins.org/get/ && \
    curl -fsSL -o ${JMETER_HOME}/lib/cmdrunner-${CMDRUNNER_VERSION}.jar \
        https://repo1.maven.org/maven2/kg/apc/cmdrunner/${CMDRUNNER_VERSION}/cmdrunner-${CMDRUNNER_VERSION}.jar && \
    java -cp ${JMETER_HOME}/lib/ext/jmeter-plugins-manager-${JMETER_PLUGINS_MANAGER_VERSION}.jar \
        org.jmeterplugins.repository.PluginManagerCMDInstaller

RUN curl -fsSL -o ${JMETER_HOME}/lib/jolokia-java-agent.jar \
        https://repo1.maven.org/maven2/org/jolokia/jolokia-jvm/${JOLOKIA_VERSION}/jolokia-jvm-${JOLOKIA_VERSION}.jar

RUN mkdir -p /opt/jmeter/scripts /report /tmp/jmeter && \
    chmod -R 775 /opt/jmeter /report /tmp/jmeter && \
    chgrp -R 0 /opt/jmeter /report /tmp/jmeter && \
    chmod -R g=u /opt/jmeter /report /tmp/jmeter

RUN useradd -u 1001 -g 0 -d /opt/jmeter -s /bin/bash jmeter
USER 1001
WORKDIR /opt/jmeter

EXPOSE 1099 50000 4445 8778
ENTRYPOINT ["/bin/bash"]
