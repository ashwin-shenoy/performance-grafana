###############################################################################
# Makefile — Common commands for the JMeter Performance Platform
###############################################################################

NAMESPACE       ?= perf-testing
JMX_FILE        ?= example.jmx
WORKER_COUNT    ?= 3
IMAGE_REGISTRY  ?= registry.example.com/perf
JMETER_VERSION  ?= 5.6.3
KUBECTL         := $(shell command -v oc 2>/dev/null || command -v kubectl)

.PHONY: help build push deploy-infra deploy-all run-test stop-test collect-results clean lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# === Docker Images ===

build: ## Build JMeter Docker images
	docker build -t $(IMAGE_REGISTRY)/jmeter-base:$(JMETER_VERSION) \
		--build-arg JMETER_VERSION=$(JMETER_VERSION) \
		docker/jmeter-base/
	docker build -t $(IMAGE_REGISTRY)/report-generator:latest \
		docker/report-generator/

push: ## Push images to registry
	docker push $(IMAGE_REGISTRY)/jmeter-base:$(JMETER_VERSION)
	docker push $(IMAGE_REGISTRY)/report-generator:latest

# === Infrastructure ===

deploy-infra: ## Deploy monitoring stack (InfluxDB, Grafana, Telegraf)
	$(KUBECTL) apply -f manifests/base/ -n $(NAMESPACE)
	$(KUBECTL) apply -f manifests/monitoring/ -n $(NAMESPACE)
	@echo "Waiting for deployments..."
	$(KUBECTL) rollout status deployment/influxdb -n $(NAMESPACE) --timeout=120s
	$(KUBECTL) rollout status deployment/grafana -n $(NAMESPACE) --timeout=120s

deploy-all: deploy-infra ## Deploy everything (infra + JMeter manifests)
	$(KUBECTL) apply -f manifests/jmeter/ -n $(NAMESPACE)

# === Test Execution ===

run-test: ## Run a performance test (JMX_FILE=x WORKER_COUNT=n NAMESPACE=ns)
	@chmod +x scripts/run-test.sh
	./scripts/run-test.sh -j $(JMX_FILE) -n $(NAMESPACE) -i $(WORKER_COUNT) -r

run-test-csv: ## Run test with CSV splitting
	@chmod +x scripts/run-test.sh
	./scripts/run-test.sh -j $(JMX_FILE) -n $(NAMESPACE) -i $(WORKER_COUNT) -c -r

run-test-full: ## Run test with CSV + modules
	@chmod +x scripts/run-test.sh
	./scripts/run-test.sh -j $(JMX_FILE) -n $(NAMESPACE) -i $(WORKER_COUNT) -c -m -r

stop-test: ## Stop a running test
	@chmod +x scripts/stop-test.sh
	./scripts/stop-test.sh -n $(NAMESPACE)

collect-results: ## Collect results from the controller pod
	@chmod +x scripts/collect-results.sh
	./scripts/collect-results.sh -n $(NAMESPACE)

# === Helm ===

helm-install: ## Install via Helm chart
	helm upgrade --install jmeter-platform helm/jmeter-platform/ \
		--namespace $(NAMESPACE) \
		--create-namespace \
		--set global.imageRegistry=$(IMAGE_REGISTRY) \
		--set jmeter.worker.replicas=$(WORKER_COUNT)

helm-uninstall: ## Uninstall Helm release
	helm uninstall jmeter-platform --namespace $(NAMESPACE)

helm-template: ## Render Helm templates locally
	helm template jmeter-platform helm/jmeter-platform/ \
		--namespace $(NAMESPACE)

# === Utilities ===

grafana-port-forward: ## Port-forward Grafana to localhost:3000
	$(KUBECTL) port-forward svc/grafana 3000:3000 -n $(NAMESPACE)

logs-controller: ## Tail controller logs
	$(KUBECTL) logs -f -l jmeter_mode=controller -c jmeter-controller -n $(NAMESPACE)

logs-workers: ## Tail worker logs
	$(KUBECTL) logs -f -l jmeter_mode=worker -c jmeter-worker -n $(NAMESPACE) --max-log-requests=10

status: ## Show pod status
	$(KUBECTL) get pods -n $(NAMESPACE) -l app.kubernetes.io/part-of=jmeter-platform -o wide

clean: ## Delete all JMeter jobs and worker pods
	$(KUBECTL) delete job jmeter-controller jmeter-workers -n $(NAMESPACE) --ignore-not-found=true
	@echo "Cleaned up JMeter jobs."

clean-all: clean ## Delete entire performance testing namespace
	$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found=true

lint: ## Lint Helm chart
	helm lint helm/jmeter-platform/
