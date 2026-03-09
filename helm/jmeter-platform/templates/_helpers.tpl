{{/*
Common labels applied to all resources
*/}}
{{- define "jmeter-platform.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: jmeter-platform
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Full image path for JMeter
*/}}
{{- define "jmeter-platform.jmeterImage" -}}
{{ .Values.global.imageRegistry }}/{{ .Values.jmeter.image.repository }}:{{ .Values.jmeter.image.tag }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "jmeter-platform.namespace" -}}
{{ .Values.global.namespace | default .Release.Namespace }}
{{- end }}
