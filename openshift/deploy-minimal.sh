#!/usr/bin/env bash
# =============================================================================
# deploy-minimal.sh — Minimal OpenShift deployment (alias for deploy.sh)
# =============================================================================
#
# This script is equivalent to deploy.sh.  The "minimal" stack IS the full
# stack — only 6 services are ever deployed:
#
#   ✅ PostgreSQL    — test-run metadata store
#   ✅ InfluxDB      — JMeter BackendListener time-series store (Flux)
#   ✅ Grafana       — live dashboards (jmeter-perf, filtered by workload+run)
#   ✅ Backend API   — REST API + on-demand JMeter Job orchestration
#   ✅ Frontend UI   — Next.js dashboard (Start/Stop/View tests)
#   ✅ Sample App    — e-commerce load-test target
#
# Prometheus, Loki, Tempo, Pyroscope, Promtail and Regression Engine have
# been intentionally removed from this project.
#
# Usage:
#   ./openshift/deploy-minimal.sh                # same as deploy.sh
#   ./openshift/deploy-minimal.sh --skip-build
#   ./openshift/deploy-minimal.sh --skip-infra
#   STORAGE_CLASS=ibmc-file-gold ./openshift/deploy-minimal.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy.sh" "$@"
