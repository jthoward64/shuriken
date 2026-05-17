{{/*
Expand the name of the chart.
*/}}
{{- define "shuriken.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name, capped at 63 chars to fit Kubernetes name limits.
*/}}
{{- define "shuriken.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "shuriken.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "shuriken.labels" -}}
helm.sh/chart: {{ include "shuriken.chart" . }}
{{ include "shuriken.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "shuriken.selectorLabels" -}}
app.kubernetes.io/name: {{ include "shuriken.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "shuriken.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "shuriken.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Name of the secret holding sensitive config. Honors `existingSecret.name`
when supplied so chart users can ship credentials out-of-band.
*/}}
{{- define "shuriken.secretName" -}}
{{- if .Values.existingSecret.name -}}
{{- .Values.existingSecret.name -}}
{{- else -}}
{{- printf "%s-secret" (include "shuriken.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Image reference (repository:tag). Falls back to .Chart.AppVersion when no
tag is given so Renovate/Dependabot only have one source of truth.
*/}}
{{- define "shuriken.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}
