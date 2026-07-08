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
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
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
Name of the chart-managed Secret holding sensitive config that hasn't been
redirected to a per-field existingSecret (see shuriken.secretEnvVar below).
*/}}
{{- define "shuriken.secretName" -}}
{{- printf "%s-secret" (include "shuriken.fullname" .) -}}
{{- end -}}

{{/*
Renders one `env:` entry sourcing a sensitive value from a Secret via
secretKeyRef — either a per-field `existingSecret` override, or (falling
back) the chart-managed Secret under the given key. Renders nothing when
neither a plaintext value nor an existingSecret override is set, so the app
sees the env var as absent (same as leaving the config value unset). Call as:
  {{- include "shuriken.secretEnvVar" (dict "root" $ "name" "DATABASE_URL" "value" .Values.config.database.url "existingSecret" .Values.config.database.existingSecret) }}
*/}}
{{- define "shuriken.secretEnvVar" -}}
{{- if .existingSecret.name }}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ .existingSecret.name }}
      key: {{ .existingSecret.key }}
{{- else if .value }}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ include "shuriken.secretName" .root }}
      key: {{ .name }}
{{- end }}
{{- end -}}

{{/*
Image reference (repository:tag). Falls back to .Chart.AppVersion when no
tag is given so Renovate/Dependabot only have one source of truth.
*/}}
{{- define "shuriken.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}
