# AI Model Distribution ODRL Profile

> MSc Dissertation Project — Trinity College Dublin, 2026  
> **Diya Mathew** · School of Computer Science & Statistics

---

## Overview

This project defines a machine-readable governance framework for open AI model distribution, built on top of the [W3C ODRL](https://www.w3.org/TR/odrl-model/) policy language and the EU [DCAT-AP](https://joinup.ec.europa.eu/collection/semantic-interoperability-community-semic/solution/dcat-application-profile-data-portals-europe) metadata standard.

Academic datasets and research papers are increasingly used to train generative AI models — often without attribution, energy disclosure, or compliance with emerging regulations like the **EU AI Act (2024)**. This project addresses that gap by:

- Extending an existing ODRL profile ([original work by Cian Twomey, 2024](https://github.com/ci2me/AI-Model-Distribution-ODRL-Profile)) with new v3 obligations
- Defining three machine-readable licence policies grounded in EU AI Act obligations
- Implementing a dynamic compliance checker that queries a GraphDB knowledge graph via SPARQL
- Supporting **multi-hop provenance tracing** — verifying that derived AI models respect the terms of every upstream training source

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Policy language | [ODRL 2.2](https://www.w3.org/TR/odrl-model/) (W3C standard) |
| Metadata standard | [DCAT-AP](https://semiceu.github.io/DCAT-AP/releases/3.0.0/) + custom `aimd:ResearchProduct` extension |
| Ontology format | [Turtle (.ttl)](https://www.w3.org/TR/turtle/) RDF |
| Knowledge graph | [GraphDB](https://graphdb.ontotext.com/) triplestore |
| Query language | [SPARQL 1.1](https://www.w3.org/TR/sparql11-query/) |
| Compliance server | [Node.js](https://nodejs.org/) with [Axios](https://axios-http.com/) |
| Legal grounding | EU AI Act Art. 9, 10, 11, 53 · DSM Directive Art. 4 · CC Signals |

---

## Repository Structure

```
├── AIMD.ttl                        # Core ODRL profile (Cian Twomey v1, 2024)
├── AIMD_extended.ttl               # v2/v3 extensions — CO₂, copyright, provenance
├── GPAILicence.ttl                 # Licence policy for General Purpose AI models
├── HighRiskAILicence.ttl           # Licence policy for High-Risk AI systems
├── OpenAccessAcademicLicence.ttl   # Licence policy for open academic repositories
├── server.js                       # Node.js compliance & provenance checker
└── package.json                    # Node.js dependencies
```

### File Descriptions

**`AIMD.ttl`** — The original AI Model Distribution ODRL Profile (v1) by Cian Twomey. Defines core vocabulary terms for AI Act prohibited uses (social scoring, biometric identification, emotional inference, etc.) and foundational obligations.

**`AIMD_extended.ttl`** — v2/v3 extensions added in this dissertation. Introduces:
- `aimd:CO2Disclosure` object with 9 sub-attributes (kgCO₂eq, energyKWh, hardware, duration, cloud region, grid carbon intensity, emissions scope, reporting standard, measurement URL)
- `aimd:CopyrightPolicy` object with 6 sub-attributes (opt-out mechanism, rights-holder registry, TDM waiver, open-access-sources flag, CC Signals compliance, policy document URL)
- `aimd:derivedFromResearchProduct` and `aimd:derivedFromDistribution` properties for multi-hop provenance tracing

**`GPAILicence.ttl`** — Machine-readable policy for General Purpose AI models. Enforces obligations under EU AI Act Art. 53(1): model card publication, dataset card, CO₂ disclosure, and bias report.

**`HighRiskAILicence.ttl`** — Machine-readable policy for High-Risk AI systems. Enforces Art. 9 (risk management), Art. 10 (data governance), Art. 11 (technical documentation), and human oversight requirements.

**`OpenAccessAcademicLicence.ttl`** — Policy for AI models trained on open academic resources. Requires share-alike licensing, model card publication, and a machine-readable link back to the source research product licence.

**`server.js`** — Node.js server (v3.0) implementing:
- `verifyCompliance(distributionURI)` — dynamically queries GraphDB for all `aimd:evidenceProperty` annotations and checks each obligation without hard-coded rules
- `verifyProvenanceChain(distributionURI)` — traces multi-hop chains (`ResearchProduct → Base Model → Fine-tuned Model`) and checks compliance at every hop
- Cross-repository licence linkage verification

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [GraphDB](https://graphdb.ontotext.com/) running locally on `http://localhost:7200`
- A GraphDB repository named **`AIModels`** with the `.ttl` files loaded

---

## How to Run

**1. Install dependencies**
```bash
npm install
```

**2. Start GraphDB** and ensure the `AIModels` repository is running at `http://localhost:7200`.

**3. Load the ontology files** into GraphDB via the GraphDB Workbench UI:
- Import all `.ttl` files into the `AIModels` repository

**4. Run the compliance checker**
```bash
npm start
```

This will:
- Upload all model distributions, policies, and relationships to GraphDB
- Run compliance checks on `IrishLegalLLMDist1.5` and `TextGenDist1.4`
- Trace the multi-hop provenance chain for `LegalLLMContractAnalysisDist1.6`
- Print a detailed compliance report to the terminal

---

## Example Output

```
Compliance check: IrishLegalLLMDist1.5
Overall: ❌ NON-COMPLIANT  (5 mandatory failures)

❌ MISSING   Establish Risk Management
❌ MISSING   Conduct Data Governance
❌ MISSING   Provide Technical Documentation
❌ MISSING   Document Training Data
❌ MISSING   Publish Bias Report
✅ COMPLIANT Attribute Training Sources
✅ COMPLIANT Make Resulting Model Open Access
✅ COMPLIANT Disclose CO₂ / Energy Emissions
✅ COMPLIANT Implement Copyright Policy

── Cross-repository licence check ──────────────
Licence chain verifiable: ✅ YES
```

---

## Key v3.0 Innovations

| Feature | Description |
|---------|-------------|
| **Graph-driven compliance** | Obligations are read dynamically from GraphDB via SPARQL — no hard-coded rules in JavaScript |
| **Structured CO₂ object** | 9 sub-attributes grounded in [CodeCarbon](https://codecarbon.io/) and [ML CO₂ Impact](https://mlco2.github.io/impact/) |
| **CopyrightPolicy object** | 6 sub-attributes grounded in EU AI Act Art. 53(1)(c) and the [CC Signals](https://creativecommons.org/ai-and-the-commons/cc-signals/) project |
| **Multi-hop provenance** | Traces `ResearchProduct → Model A → Fine-tuned Model B`, checking compliance at every hop |
| **Cross-repo licence check** | Verifies that a distribution's licence is consistent with its upstream research product |

---

## Acknowledgements

- **Original AIMD Profile (v1):** [Cian Twomey (2024)](https://github.com/ci2me/AI-Model-Distribution-ODRL-Profile)
- **Supervisor:** TCD School of Computer Science & Statistics
- **Institution:** [Trinity College Dublin](https://www.tcd.ie)
- This project builds on research discussed in: [DCAT and ODRL for AI Risk Tracking](https://arxiv.org/html/2501.04014v1)

---

## Licence

This project is released under the [Creative Commons Attribution 4.0 International Licence](https://creativecommons.org/licenses/by/4.0/).
