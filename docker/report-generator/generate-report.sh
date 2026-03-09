#!/usr/bin/env bash
set -euo pipefail

JTL_FILE="${1:-/results/results.jtl}"
REPORT_DIR="${2:-/report/html-report-$(date +%F_%H%M%S)}"
S3_BUCKET="${S3_BUCKET:-}"

echo "[INFO] Generating HTML report from ${JTL_FILE}"
jmeter -g "${JTL_FILE}" -o "${REPORT_DIR}"

echo "[INFO] Report generated at ${REPORT_DIR}"

if [ -n "${S3_BUCKET}" ]; then
    echo "[INFO] Uploading report to s3://${S3_BUCKET}/reports/"
    aws s3 cp "${REPORT_DIR}" "s3://${S3_BUCKET}/reports/$(basename ${REPORT_DIR})" --recursive
    echo "[INFO] Upload complete"
fi

echo "[INFO] Report generation finished"
