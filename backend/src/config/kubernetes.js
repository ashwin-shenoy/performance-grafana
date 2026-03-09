/**
 * Kubernetes / OpenShift Client Configuration
 * Auto-detects in-cluster vs local kubeconfig
 */
'use strict';

const k8s = require('@kubernetes/client-node');
const logger = require('../utils/logger');

let batchApi;
let coreApi;
let kc;

async function initKubeClient() {
  kc = new k8s.KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
    logger.info('Loaded in-cluster Kubernetes config');
  } else {
    kc.loadFromDefault();
    logger.info('Loaded local kubeconfig');
  }

  batchApi = kc.makeApiClient(k8s.BatchV1Api);
  coreApi = kc.makeApiClient(k8s.CoreV1Api);

  // Verify connectivity
  const ns = process.env.KUBE_NAMESPACE || 'perf-testing';
  try {
    await coreApi.readNamespace(ns);
    logger.info(`Kubernetes namespace '${ns}' accessible`);
  } catch (err) {
    logger.warn(`Namespace '${ns}' not found or not accessible: ${err.message}`);
  }
}

function getBatchApi() {
  if (!batchApi) throw new Error('Kubernetes client not initialized');
  return batchApi;
}

function getCoreApi() {
  if (!coreApi) throw new Error('Kubernetes client not initialized');
  return coreApi;
}

function getKubeConfig() {
  return kc;
}

module.exports = { initKubeClient, getBatchApi, getCoreApi, getKubeConfig };
