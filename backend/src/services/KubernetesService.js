/**
 * KubernetesService — Low-level K8s/OpenShift operations
 *
 * Wraps @kubernetes/client-node to:
 *  - Create/delete Jobs for JMeter controller and workers
 *  - Wait for pod readiness
 *  - Monitor job completion
 *  - Collect results from pods
 */
'use strict';

const k8s = require('@kubernetes/client-node');
const { getBatchApi, getCoreApi, getKubeConfig } = require('../config/kubernetes');
const logger = require('../utils/logger');

const RESULTS_PVC = process.env.RESULTS_PVC || 'jmeter-results-pvc';

class KubernetesService {
  /**
   * Create JMeter worker job
   */
  static async createWorkerJob({ name, namespace, parallelism, image, executionId, resources }) {
    const batchApi = getBatchApi();

    const job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace,
        labels: {
          'app.kubernetes.io/part-of': 'perf-platform',
          'app.kubernetes.io/component': 'jmeter-worker',
          'execution-id': String(executionId),
          'jmeter_mode': 'worker',
        },
      },
      spec: {
        backoffLimit: 0,
        parallelism,
        ttlSecondsAfterFinished: 600,
        template: {
          metadata: {
            labels: {
              'jmeter_mode': 'worker',
              'execution-id': String(executionId),
            },
          },
          spec: {
            securityContext: { runAsNonRoot: true, fsGroup: 0 },
            containers: [{
              name: 'jmeter-worker',
              image,
              imagePullPolicy: 'Always',
              command: ['/bin/bash'],
              args: ['-c', "trap 'exit 0' SIGUSR1 && while true; do sleep 30; done"],
              env: [
                { name: 'MODE', value: 'WORKER' },
                { name: 'JVM_ARGS', value: '-Xms1g -Xmx2g' },
              ],
              ports: [
                { containerPort: 1099, name: 'jmeter-rmi' },
                { containerPort: 50000, name: 'jmeter-data' },
                { containerPort: 8778, name: 'jolokia' },
              ],
              resources,
              livenessProbe: {
                exec: { command: ['cat', '/opt/jmeter/apache-jmeter/bin/jmeter'] },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
            }],
            restartPolicy: 'Never',
            affinity: {
              podAntiAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [{
                  weight: 100,
                  podAffinityTerm: {
                    labelSelector: {
                      matchExpressions: [{ key: 'jmeter_mode', operator: 'In', values: ['worker'] }],
                    },
                    topologyKey: 'kubernetes.io/hostname',
                  },
                }],
              },
            },
          },
        },
      },
    };

    await batchApi.createNamespacedJob(namespace, job);
    logger.info(`Created worker job '${name}' with parallelism=${parallelism}`);
  }

  /**
   * Create JMeter controller job
   */
  static async createControllerJob({ name, namespace, image, executionId, jmxContent, jmxFileName, workerJobName, params }) {
    const batchApi = getBatchApi();
    const coreApi = getCoreApi();

    // Create a ConfigMap with the JMX content
    const configMapName = `jmx-${String(executionId).slice(-8)}`;
    await coreApi.createNamespacedConfigMap(namespace, {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: configMapName,
        labels: { 'execution-id': String(executionId) },
      },
      data: {
        [jmxFileName]: jmxContent,
        'test-params.env': Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      },
    });

    // Build JMeter CLI arguments from parameters
    const jmeterProps = [
      params.host ? `-Ghost=${params.host}` : '',
      params.port ? `-Gport=${params.port}` : '',
      params.protocol ? `-Gprotocol=${params.protocol}` : '',
      params.threads ? `-Gthreads=${params.threads}` : '',
      params.duration ? `-Gduration=${params.duration}` : '',
      params.rampup ? `-Grampup=${params.rampup}` : '',
    ].filter(Boolean).join(' ');

    const reportDir = `/report/exec-${executionId}`;

    const startScript = `
      set -e
      cd /opt/jmeter/apache-jmeter/bin
      cp /jmx-config/${jmxFileName} .

      echo "Installing plugins..."
      sh PluginsManagerCMD.sh install-for-jmx ${jmxFileName} || true

      echo "Discovering workers..."
      WORKERS=$(getent hosts ${workerJobName} | awk '{print $1}' | paste -sd, -)
      if [ -z "$WORKERS" ]; then
        echo "ERROR: No workers found"
        exit 1
      fi
      echo "Workers: $WORKERS"

      mkdir -p ${reportDir}
      echo "Starting distributed test..."
      jmeter ${jmeterProps} \\
        --logfile ${reportDir}/results.jtl \\
        --reportatendofloadtests \\
        --reportoutputfolder ${reportDir}/html-report \\
        --nongui --testfile ${jmxFileName} \\
        -Dserver.rmi.ssl.disable=true \\
        --remoteexit --remotestart $WORKERS \\
        >> ${reportDir}/jmeter-controller.log 2>&1

      echo "Test completed. Results at ${reportDir}"
    `;

    const job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace,
        labels: {
          'app.kubernetes.io/part-of': 'perf-platform',
          'app.kubernetes.io/component': 'jmeter-controller',
          'execution-id': String(executionId),
          'jmeter_mode': 'controller',
        },
      },
      spec: {
        completions: 1,
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: {
            labels: {
              'jmeter_mode': 'controller',
              'execution-id': String(executionId),
            },
          },
          spec: {
            securityContext: { runAsNonRoot: true, fsGroup: 0 },
            containers: [{
              name: 'jmeter-controller',
              image,
              imagePullPolicy: 'Always',
              command: ['/bin/bash', '-c', startScript],
              env: [
                { name: 'MODE', value: 'CONTROLLER' },
                { name: 'JVM_ARGS', value: '-Xms512m -Xmx1024m' },
              ],
              volumeMounts: [
                { name: 'results', mountPath: '/report' },
                { name: 'jmx-config', mountPath: '/jmx-config' },
              ],
              resources: {
                requests: { cpu: '1', memory: '1Gi' },
                limits: { cpu: '2', memory: '2Gi' },
              },
            }],
            restartPolicy: 'Never',
            volumes: [
              { name: 'results', persistentVolumeClaim: { claimName: RESULTS_PVC } },
              { name: 'jmx-config', configMap: { name: configMapName } },
            ],
          },
        },
      },
    };

    await batchApi.createNamespacedJob(namespace, job);
    logger.info(`Created controller job '${name}'`);
  }

  /**
   * Wait for N pods with given label to reach Ready state
   */
  static async waitForPods(namespace, labelSelector, expectedCount, timeoutSec = 300) {
    const coreApi = getCoreApi();
    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      const { body } = await coreApi.listNamespacedPod(
        namespace, undefined, undefined, undefined, undefined, labelSelector
      );

      const readyCount = body.items.filter((pod) => {
        const conditions = pod.status?.conditions || [];
        return conditions.some((c) => c.type === 'Ready' && c.status === 'True');
      }).length;

      if (readyCount >= expectedCount) {
        logger.info(`All ${expectedCount} pods ready (label: ${labelSelector})`);
        return;
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error(`Timeout waiting for ${expectedCount} pods (label: ${labelSelector})`);
  }

  /**
   * Wait for a Job to reach Complete or Failed condition
   */
  static async waitForJobCompletion(namespace, jobName, timeoutSec = 7200) {
    const batchApi = getBatchApi();
    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      try {
        const { body } = await batchApi.readNamespacedJob(jobName, namespace);
        const conditions = body.status?.conditions || [];

        for (const c of conditions) {
          if (c.type === 'Complete' && c.status === 'True') return 'Complete';
          if (c.type === 'Failed' && c.status === 'True') return 'Failed';
        }
      } catch (err) {
        if (err.statusCode === 404) return 'Deleted';
      }

      await new Promise((r) => setTimeout(r, 10000));
    }

    return 'Timeout';
  }

  /**
   * Collect result paths from the controller pod
   */
  static async collectResults(namespace, controllerJobName, executionId) {
    // Results are written to PVC, so we just return the path references
    return {
      jtlPath: `/report/exec-${executionId}/results.jtl`,
      reportPath: `/report/exec-${executionId}/html-report`,
      summary: {},
    };
  }

  /**
   * Delete a Job (propagation: Background deletes pods too)
   */
  static async deleteJob(namespace, jobName) {
    const batchApi = getBatchApi();
    await batchApi.deleteNamespacedJob(
      jobName,
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'Background'
    );
    logger.info(`Deleted job '${jobName}' in namespace '${namespace}'`);
  }

  /**
   * Get pods by label selector
   */
  static async getPodsByLabel(namespace, labelSelector) {
    const coreApi = getCoreApi();
    const { body } = await coreApi.listNamespacedPod(
      namespace, undefined, undefined, undefined, undefined, labelSelector
    );
    return body.items.map((pod) => ({
      name: pod.metadata.name,
      phase: pod.status?.phase,
      nodeName: pod.spec?.nodeName,
      startTime: pod.status?.startTime,
      ready: (pod.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
    }));
  }
}

module.exports = KubernetesService;
