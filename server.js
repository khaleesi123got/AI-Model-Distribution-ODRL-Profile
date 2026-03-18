/**
 * server.js — AIMD Extended v3.0
 *
 * Original prototype: Cian Twomey, 2024
 * Extended by:        Diya Mathew, 2026
 *
 * v3.0 changes (supervisor feedback, 26 Feb 2026):
 *
 *  1. GRAPH-DRIVEN COMPLIANCE CHECKER
 *     verifyCompliance() no longer has obligations hardcoded in JavaScript.
 *     It queries GraphDB for all aimd:Action nodes that carry an
 *     aimd:evidenceProperty annotation, then checks each one dynamically.
 *     This means you can extend the ontology (add new obligations, change
 *     severity) without touching the checker code.
 *
 *  2. DEEP CO2/ENERGY SUB-ATTRIBUTES  (aimd:CO2Disclosure object)
 *     Each AI model distribution now carries a structured CO2Disclosure node
 *     with: kgCO2eq, energyKWhTotal, trainingHardware, trainingDurationHours,
 *     cloudRegion, gridCarbonIntensity, emissionsScope, reportingStandard,
 *     co2MeasurementURL.
 *     Grounded in CodeCarbon, ML CO2 Impact (Lacoste et al. 2019), and the
 *     Hugging Face CO2 model card spec.
 *
 *  3. DEEP COPYRIGHT/IP SUB-ATTRIBUTES  (aimd:CopyrightPolicy object)
 *     Each AI model distribution now carries a structured CopyrightPolicy node
 *     with: optOutMechanism, rightsHolderRegistry, tdmWaiver,
 *     openAccessSourcesOnly, ccSignalsCompliant, copyrightPolicyDocURL.
 *     Grounded in EU AI Act Art. 53(1)(c), DSM Directive Art. 4, and the
 *     CC Signals project.
 *
 *  4. MULTI-HOP PROVENANCE
 *     verifyProvenanceChain() traces chains of the form:
 *       ResearchProduct → Model A → Fine-tuned Model B
 *     via aimd:derivedFromResearchProduct and aimd:derivedFromDistribution,
 *     checking compliance at every hop.
 */

const axios = require("axios");

// ─────────────────────────────────────────────
// GraphDB config
// ─────────────────────────────────────────────
const graphdbBaseUrl  = "http://localhost:7200";
const repositoryId    = "AIModels";
const sparqlUpdateEndpoint = `${graphdbBaseUrl}/repositories/${repositoryId}/statements`;
const sparqlQueryEndpoint  = `${graphdbBaseUrl}/repositories/${repositoryId}`;

const AIMD_BASE = "https://raw.githubusercontent.com/ci2me/AI-Model-Distribution-ODRL-Profile/main/AIMD.ttl#";

const PREFIXES = `
PREFIX dcat:   <https://www.w3.org/ns/dcat#>
PREFIX odrl:   <http://www.w3.org/ns/odrl/2/>
PREFIX rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dct:    <http://purl.org/dc/terms/>
PREFIX airo:   <https://w3id.org/airo#>
PREFIX aimd:   <${AIMD_BASE}>
PREFIX xsd:    <http://www.w3.org/2001/XMLSchema#>
PREFIX foaf:   <http://xmlns.com/foaf/0.1/>
PREFIX duv:    <http://www.w3.org/ns/duv#>
PREFIX cc:     <http://creativecommons.org/ns#>
PREFIX schema: <http://schema.org/>
PREFIX skos:   <http://www.w3.org/2004/02/skos/core#>
`;

// ─────────────────────────────────────────────
// SPARQL helpers
// ─────────────────────────────────────────────
function logAxiosError(prefix, error) {
    if (error.response) {
        console.error(`${prefix}: HTTP ${error.response.status}`);
        console.error(String(error.response.data).slice(0, 500));
    } else if (error.request) {
        console.error(`${prefix}: no response from server`);
    } else {
        console.error(`${prefix}: ${error.message}`);
    }
}

async function sparqlUpdate(query) {
    try {
        const response = await axios.post(
            sparqlUpdateEndpoint,
            `update=${encodeURIComponent(query)}`,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        return response.status;
    } catch (error) {
        logAxiosError("SPARQL Update Error", error);
        return null;
    }
}

async function sparqlSelect(query) {
    try {
        const response = await axios.post(
            sparqlQueryEndpoint,
            `query=${encodeURIComponent(query)}`,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/sparql-results+json",
                },
            }
        );
        return response.data.results.bindings;
    } catch (error) {
        logAxiosError("SPARQL Select Error", error);
        return [];
    }
}

// ─────────────────────────────────────────────
// INSERT: Catalogue
// ─────────────────────────────────────────────
async function insertCatalogue(catalogID, description, publisher) {
    const q = `${PREFIXES}
INSERT DATA {
  dcat:${catalogID} a dcat:Catalog ;
      dct:description "${description}" ;
      dct:publisher "${publisher}" .
}`;
    const s = await sparqlUpdate(q);
    console.log(`Catalogue ${catalogID}: ${s}`);
}

// ─────────────────────────────────────────────
// INSERT: ResearchProduct (DCAT-AP + OpenAIRE)
// ─────────────────────────────────────────────
async function insertResearchProduct({ id, title, creator, issued, description, doi, repoURL, licenceURI, keyword }) {
    const doiTriple = doi ? `dct:identifier "${doi}" ;` : "";
    const q = `${PREFIXES}
INSERT DATA {
  dcat:${id} a dcat:Dataset, aimd:ResearchProduct ;
      dct:title "${title}" ;
      dct:creator "${creator}" ;
      dct:issued "${issued}"^^xsd:date ;
      dct:description "${description}" ;
      dcat:keyword "${keyword}" ;
      dcat:accessURL <${repoURL}> ;
      ${doiTriple}
      dct:license <${licenceURI}> .
}`;
    const s = await sparqlUpdate(q);
    console.log(`ResearchProduct ${id}: ${s}`);
}

// ─────────────────────────────────────────────
// INSERT: AI Model Resource (extended with v2/v3 fields)
// ─────────────────────────────────────────────
async function insertAIModelResource({
    resID, creator, title, date, desc, domain, purpose, capability, user, subject,
    modelCardURL, datasetCardURL, biasReportURL,
    trainingDataSummaryURL, riskAssessmentURL,
}) {
    const P = "https://example.com/placeholder/";
    const q = `${PREFIXES}
INSERT DATA {
  dcat:${resID} a dcat:Resource ;
      dct:title "${title}" ;
      dct:creator "${creator}" ;
      dct:issued "${date}"^^xsd:date ;
      dct:description "${desc}" ;
      airo:isAppliedWithinDomain "${domain}" ;
      airo:hasPurpose "${purpose}" ;
      airo:hasCapability "${capability}" ;
      airo:isUsedBy "${user}" ;
      airo:hasAISubject "${subject}" ;
      aimd:modelCardURL <${modelCardURL || P + "model-card"}> ;
      aimd:datasetCardURL <${datasetCardURL || P + "dataset-card"}> ;
      aimd:biasReportURL <${biasReportURL || P + "bias-report"}> ;
      aimd:trainingDataSummaryURL <${trainingDataSummaryURL || P + "training-data"}> ;
      aimd:riskAssessmentURL <${riskAssessmentURL || P + "risk-assessment"}> .
}`;
    const s = await sparqlUpdate(q);
    console.log(`AIModel ${resID}: ${s}`);
}

// ─────────────────────────────────────────────
// INSERT: CO2Disclosure node (v3.0 deep extension)
// Linked from the distribution via aimd:co2Disclosure
// ─────────────────────────────────────────────
async function insertCO2Disclosure(disclosureID, {
    kgCO2eq,
    energyKWhTotal,
    trainingHardware,
    trainingDurationHours,
    cloudRegion,
    gridCarbonIntensity,
    emissionsScope,
    reportingStandard,
    co2MeasurementURL,
}) {
    const P = "https://example.com/placeholder/";
    const q = `${PREFIXES}
INSERT DATA {
  aimd:${disclosureID} a aimd:CO2Disclosure ;
      aimd:kgCO2eq "${kgCO2eq || 0}"^^xsd:decimal ;
      aimd:energyKWhTotal "${energyKWhTotal || 0}"^^xsd:decimal ;
      aimd:trainingHardware "${trainingHardware || "unknown"}" ;
      aimd:trainingDurationHours "${trainingDurationHours || 0}"^^xsd:decimal ;
      aimd:cloudRegion "${cloudRegion || "unknown"}" ;
      aimd:gridCarbonIntensity "${gridCarbonIntensity || 0}"^^xsd:decimal ;
      aimd:emissionsScope "${emissionsScope || "training"}" ;
      aimd:reportingStandard "${reportingStandard || "unknown"}" ;
      aimd:co2MeasurementURL <${co2MeasurementURL || P + "co2-report"}> .
}`;
    const s = await sparqlUpdate(q);
    console.log(`CO2Disclosure ${disclosureID}: ${s}`);
}

// ─────────────────────────────────────────────
// INSERT: CopyrightPolicy node (v3.0 deep extension)
// Linked from the distribution via aimd:copyrightPolicy
// ─────────────────────────────────────────────
async function insertCopyrightPolicy(policyNodeID, {
    optOutMechanism,
    rightsHolderRegistry,
    tdmWaiver,
    openAccessSourcesOnly,
    ccSignalsCompliant,
    copyrightPolicyDocURL,
}) {
    const P = "https://example.com/placeholder/";
    const q = `${PREFIXES}
INSERT DATA {
  aimd:${policyNodeID} a aimd:CopyrightPolicy ;
      aimd:optOutMechanism "${optOutMechanism || "none declared"}" ;
      aimd:rightsHolderRegistry <${rightsHolderRegistry || P + "rights-registry"}> ;
      aimd:tdmWaiver "${tdmWaiver || "none declared"}" ;
      aimd:openAccessSourcesOnly "${openAccessSourcesOnly === true}"^^xsd:boolean ;
      aimd:ccSignalsCompliant "${ccSignalsCompliant === true}"^^xsd:boolean ;
      aimd:copyrightPolicyDocURL <${copyrightPolicyDocURL || P + "copyright-policy"}> .
}`;
    const s = await sparqlUpdate(q);
    console.log(`CopyrightPolicy ${policyNodeID}: ${s}`);
}

// ─────────────────────────────────────────────
// INSERT: Distribution (v3.0 — links to CO2Disclosure + CopyrightPolicy nodes)
// ─────────────────────────────────────────────
async function insertDistribution(distID, accessURL, date, {
    sourceResearchProductID = null,
    parentDistributionID = null,     // for fine-tuned models (multi-hop)
    co2DisclosureID = null,
    copyrightPolicyNodeID = null,
} = {}) {
    const rpTriple   = sourceResearchProductID ? `aimd:derivedFromResearchProduct dcat:${sourceResearchProductID} ;` : "";
    const distTriple = parentDistributionID    ? `aimd:derivedFromDistribution dcat:${parentDistributionID} ;`       : "";
    const co2Triple  = co2DisclosureID         ? `aimd:co2Disclosure aimd:${co2DisclosureID} ;`                      : "";
    const cpTriple   = copyrightPolicyNodeID   ? `aimd:copyrightPolicy aimd:${copyrightPolicyNodeID} ;`              : "";
    const q = `${PREFIXES}
INSERT DATA {
  dcat:${distID} a dcat:Distribution, aimd:AIModelDistribution ;
      dcat:accessURL <${accessURL}> ;
      dct:issued "${date}"^^xsd:date ;
      ${rpTriple}
      ${distTriple}
      ${co2Triple}
      ${cpTriple}
      dct:format "application/x-hdf5" .
}`;
    const s = await sparqlUpdate(q);
    console.log(`Distribution ${distID}: ${s}`);
}

// ─────────────────────────────────────────────
// Relationship / Policy / Usage helpers (unchanged from v2.0)
// ─────────────────────────────────────────────
async function insertRelationship(from, to) {
    const q = `${PREFIXES}
INSERT DATA { dcat:${from} dcat:dataset dcat:${to} . }`;
    const s = await sparqlUpdate(q);
    console.log(`Rel ${from} -> ${to}: ${s}`);
}

async function linkResearchProductToCatalogue(catalogID, rpID) {
    const q = `${PREFIXES}
INSERT DATA { dcat:${catalogID} dcat:dataset dcat:${rpID} . }`;
    const s = await sparqlUpdate(q);
    console.log(`Cat ${catalogID} -> RP ${rpID}: ${s}`);
}

async function linkDistributionToResearchProduct(distID, rpID) {
    const q = `${PREFIXES}
INSERT DATA { dcat:${distID} aimd:derivedFromResearchProduct dcat:${rpID} . }`;
    const s = await sparqlUpdate(q);
    console.log(`Dist ${distID} -> RP ${rpID}: ${s}`);
}

async function insertPolicy(policyID, accessURL) {
    const q = `${PREFIXES}
INSERT DATA {
  odrl:${policyID} a odrl:Policy ;
      dcat:accessURL <${accessURL}> ;
      dct:title "${policyID}" .
}`;
    const s = await sparqlUpdate(q);
    console.log(`Policy ${policyID}: ${s}`);
}

async function assignPolicy(distID, policyID) {
    const q = `${PREFIXES}
INSERT DATA {
  dcat:${distID} odrl:hasPolicy odrl:${policyID} ;
                 dct:license odrl:${policyID} .
}`;
    const s = await sparqlUpdate(q);
    console.log(`Assign policy ${policyID} -> ${distID}: ${s}`);
}

async function insertUsage(usageID, organisation, date, accessURL) {
    const q = `${PREFIXES}
INSERT DATA {
  duv:${usageID} a duv:Usage ;
      foaf:organization "${organisation}" ;
      dct:issued "${date}"^^xsd:date ;
      dcat:accessURL <${accessURL}> .
}`;
    const s = await sparqlUpdate(q);
    console.log(`Usage ${usageID}: ${s}`);
}

async function assignUsage(distID, usageID) {
    const q = `${PREFIXES}
INSERT DATA { dcat:${distID} duv:hasUsage duv:${usageID} . }`;
    await sparqlUpdate(q);
}

async function insertUsageHasResource(usageID, resourceID) {
    const q = `${PREFIXES}
INSERT DATA { duv:${usageID} dcat:dataset dcat:${resourceID} . }`;
    await sparqlUpdate(q);
}

async function searchDistributionByPolicy(policyURI) {
    const q = `${PREFIXES}
SELECT ?Distribution WHERE {
    ?Distribution a dcat:Distribution ;
                  odrl:hasPolicy <${policyURI}> .
}`;
    const results = await sparqlSelect(q);
    return results.map((r) => r.Distribution.value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE VERIFICATION  v3.0 — GRAPH-DRIVEN
//
// Instead of hardcoding the obligation list, this function:
//   1. Queries GraphDB for all aimd:Action nodes that have aimd:evidenceProperty
//      defined (i.e. they are checkable obligations).
//   2. For each, reads the evidenceProperty URI, severity, checkDescription,
//      and legalBasis from the graph.
//   3. Checks the distribution node for the declared evidence value.
//   4. Applies placeholder detection.
//
// This means the compliance rules live entirely in the knowledge graph —
// extending AIMD_extended.ttl automatically extends the checks.
// ═══════════════════════════════════════════════════════════════════════════════
async function verifyCompliance(distributionID) {
    const HR = "─".repeat(65);
    console.log(`\n${HR}`);
    console.log(`  Compliance check: dcat:${distributionID}`);
    console.log(HR);

    // ── Step 1: Load obligation definitions from the graph ───────────────────
    const obligationQuery = `${PREFIXES}
SELECT ?action ?label ?evidenceProp ?severity ?checkDesc ?legalBasis
WHERE {
    ?action a odrl:Action ;
            aimd:evidenceProperty ?evidenceProp .
    OPTIONAL { ?action rdfs:label ?label }
    OPTIONAL { ?action aimd:severity ?severity }
    OPTIONAL { ?action aimd:checkDescription ?checkDesc }
    OPTIONAL { ?action aimd:legalBasis ?legalBasis }
}`;
    const obligationBindings = await sparqlSelect(obligationQuery);

    if (obligationBindings.length === 0) {
        console.log("  ⚠️  No graph-defined obligations found.");
        console.log("     Make sure AIMD_extended.ttl has been imported into GraphDB.");
        console.log(`${HR}\n`);
        return { distributionID, allCompliant: false, results: [] };
    }

    // Deduplicate by evidenceProperty (multiple actions can share one prop)
    const seen = new Set();
    const obligations = [];
    for (const b of obligationBindings) {
        const ep = b.evidenceProp.value;
        if (!seen.has(ep)) {
            seen.add(ep);
            obligations.push({
                actionURI:    b.action.value,
                label:        b.label?.value      || b.action.value.split("#").pop(),
                evidenceProp: ep,
                severity:     b.severity?.value   || "mandatory",
                checkDesc:    b.checkDesc?.value   || "",
                legalBasis:   b.legalBasis?.value  || "",
            });
        }
    }

    // ── Step 2: Load all properties of the distribution from the graph ───────
    const metaQuery = `${PREFIXES}
SELECT ?prop ?val
WHERE { dcat:${distributionID} ?prop ?val . }`;
    const metaBindings = await sparqlSelect(metaQuery);

    const declared = {};
    for (const b of metaBindings) {
        declared[b.prop.value] = b.val.value;
    }

    // ── Step 3: Also load CO2Disclosure sub-attributes if present ────────────
    const co2Query = `${PREFIXES}
SELECT ?subProp ?subVal
WHERE {
  dcat:${distributionID} aimd:co2Disclosure ?disc .
  ?disc ?subProp ?subVal .
}`;
    const co2Bindings = await sparqlSelect(co2Query);
    const co2Data = {};
    for (const b of co2Bindings) {
        co2Data[b.subProp.value] = b.subVal.value;
    }

    // ── Step 4: Also load CopyrightPolicy sub-attributes if present ──────────
    const cpQuery = `${PREFIXES}
SELECT ?subProp ?subVal
WHERE {
  dcat:${distributionID} aimd:copyrightPolicy ?cp .
  ?cp ?subProp ?subVal .
}`;
    const cpBindings = await sparqlSelect(cpQuery);
    const cpData = {};
    for (const b of cpBindings) {
        cpData[b.subProp.value] = b.subVal.value;
    }

    // ── Step 5: Evaluate each obligation ─────────────────────────────────────
    const PLACEHOLDER = "https://example.com/placeholder/";
    const results = [];
    let mandatoryFails = 0;
    let recommendedFails = 0;

    for (const ob of obligations) {
        const value = declared[ob.evidenceProp];
        const present = value !== undefined && !value.startsWith(PLACEHOLDER);
        if (!present && ob.severity === "mandatory") mandatoryFails++;
        if (!present && ob.severity === "recommended") recommendedFails++;

        const icon = present
            ? "✅ COMPLIANT  "
            : ob.severity === "mandatory" ? "❌ MISSING    " : "⚠️  RECOMMENDED";

        results.push({ ...ob, present, value: value || "(not declared)", icon });
    }

    // ── Step 6: Detailed sub-attribute checks ────────────────────────────────
    // CO2 Disclosure sub-checks
    const co2SubChecks = checkCO2SubAttributes(co2Data, PLACEHOLDER);
    // Copyright Policy sub-checks
    const cpSubChecks  = checkCopyrightSubAttributes(cpData, PLACEHOLDER);

    // ── Step 7: Print main report ─────────────────────────────────────────────
    const overall = mandatoryFails === 0 ? "✅ FULLY COMPLIANT" : "❌ NON-COMPLIANT";
    console.log(`\n  Overall: ${overall}  (${mandatoryFails} mandatory failures, ${recommendedFails} recommended gaps)\n`);

    for (const r of results) {
        console.log(`  ${r.icon}  ${r.label}`);
        if (r.checkDesc) console.log(`               ${r.checkDesc}`);
        if (r.legalBasis) console.log(`               Legal basis: ${r.legalBasis}`);
        if (!r.present)   console.log(`               → Value: ${r.value}`);
        console.log();
    }

    // ── Step 8: Print CO2 sub-attribute detail ────────────────────────────────
    if (co2Bindings.length > 0) {
        console.log("  ── CO2 / Energy Disclosure — sub-attributes ──────────────────");
        for (const c of co2SubChecks) {
            console.log(`  ${c.icon}  ${c.label}`);
            if (!c.present) console.log(`               → ${c.value}`);
        }
        console.log();
    } else {
        console.log("  ❌ CO2 Disclosure object missing — no sub-attributes to check.\n");
    }

    // ── Step 9: Print Copyright sub-attribute detail ──────────────────────────
    if (cpBindings.length > 0) {
        console.log("  ── Copyright / IP Policy — sub-attributes ────────────────────");
        for (const c of cpSubChecks) {
            console.log(`  ${c.icon}  ${c.label}`);
            if (!c.present) console.log(`               → ${c.value}`);
        }
        console.log();
    } else {
        console.log("  ❌ Copyright Policy object missing — no sub-attributes to check.\n");
    }

    // ── Step 10: Cross-repo licence check ────────────────────────────────────
    await crossRepoLicenceCheck(distributionID);

    console.log(`${HR}\n`);
    return { distributionID, allCompliant: mandatoryFails === 0, results };
}

// ── CO2 sub-attribute checker ─────────────────────────────────────────────────
function checkCO2SubAttributes(co2Data, PLACEHOLDER) {
    const fields = [
        { key: `${AIMD_BASE}kgCO2eq`,             label: "kg CO2 equivalent declared",          severity: "mandatory"  },
        { key: `${AIMD_BASE}energyKWhTotal`,       label: "Total energy (kWh) declared",         severity: "mandatory"  },
        { key: `${AIMD_BASE}trainingHardware`,     label: "Training hardware specified",         severity: "mandatory"  },
        { key: `${AIMD_BASE}trainingDurationHours`,label: "Training duration (hours) declared",  severity: "recommended"},
        { key: `${AIMD_BASE}cloudRegion`,          label: "Cloud region / data centre declared", severity: "recommended"},
        { key: `${AIMD_BASE}gridCarbonIntensity`,  label: "Grid carbon intensity declared",      severity: "recommended"},
        { key: `${AIMD_BASE}emissionsScope`,       label: "Emissions scope declared",            severity: "mandatory"  },
        { key: `${AIMD_BASE}reportingStandard`,    label: "Reporting standard declared (e.g. CodeCarbon)", severity: "mandatory"},
        { key: `${AIMD_BASE}co2MeasurementURL`,    label: "CO2 measurement report URL present",  severity: "recommended"},
    ];
    return fields.map(f => {
        const val = co2Data[f.key];
        const unknown = !val || val === "unknown" || val === "0" || (val && val.startsWith(PLACEHOLDER));
        const present = val !== undefined && !unknown;
        const icon = present ? "✅" : f.severity === "mandatory" ? "❌" : "⚠️ ";
        return { label: f.label, present, value: val || "(not declared)", icon, severity: f.severity };
    });
}

// ── Copyright sub-attribute checker ──────────────────────────────────────────
function checkCopyrightSubAttributes(cpData, PLACEHOLDER) {
    const fields = [
        { key: `${AIMD_BASE}optOutMechanism`,      label: "Opt-out mechanism declared (robots.txt / Spawning / HIBT)", severity: "mandatory"  },
        { key: `${AIMD_BASE}rightsHolderRegistry`, label: "Rights-holder registry URL present",                        severity: "mandatory"  },
        { key: `${AIMD_BASE}tdmWaiver`,            label: "TDM waiver / licence declared",                             severity: "mandatory"  },
        { key: `${AIMD_BASE}openAccessSourcesOnly`,label: "Open-access-sources-only flag declared",                    severity: "recommended"},
        { key: `${AIMD_BASE}ccSignalsCompliant`,   label: "CC Signals compliance declared",                            severity: "recommended"},
        { key: `${AIMD_BASE}copyrightPolicyDocURL`,label: "Copyright policy document URL present",                     severity: "mandatory"  },
    ];
    return fields.map(f => {
        const val = cpData[f.key];
        const notDeclared = !val || val === "none declared" || (val && val.startsWith(PLACEHOLDER));
        const present = val !== undefined && !notDeclared;
        const icon = present ? "✅" : f.severity === "mandatory" ? "❌" : "⚠️ ";
        return { label: f.label, present, value: val || "(not declared)", icon, severity: f.severity };
    });
}

// ── Cross-repository licence check ───────────────────────────────────────────
async function crossRepoLicenceCheck(distributionID) {
    const q = `${PREFIXES}
SELECT ?sourcePolicy ?distPolicy ?rpTitle
WHERE {
  dcat:${distributionID} aimd:derivedFromResearchProduct ?sourceRP .
  ?sourceRP dct:license ?sourcePolicy .
  OPTIONAL { ?sourceRP dct:title ?rpTitle }
  OPTIONAL { dcat:${distributionID} dct:license ?distPolicy . }
}`;
    const bindings = await sparqlSelect(q);
    console.log("  ── Cross-repository licence check ────────────────────────────");
    if (bindings.length > 0) {
        const sp  = bindings[0]?.sourcePolicy?.value || "(not found)";
        const dp  = bindings[0]?.distPolicy?.value   || "(not declared)";
        const rpt = bindings[0]?.rpTitle?.value       || "unknown";
        console.log(`  Source research product   : ${rpt}`);
        console.log(`  Source licence policy     : ${sp}`);
        console.log(`  Distribution licence      : ${dp}`);
        const ok = sp !== "(not found)" && dp !== "(not declared)";
        console.log(`  Licence chain verifiable  : ${ok ? "✅ YES" : "⚠️  MISSING — one or both sides undeclared"}`);
    } else {
        console.log("  ⚠️  No source ResearchProduct link found — cross-repo check skipped.");
    }
    console.log();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-HOP PROVENANCE CHAIN VERIFICATION  (v3.0)
//
// Traces the full derivation chain for a distribution:
//   e.g. tara-dataset-002
//         └─ IrishLegalLLMDist1.5   (trained on dataset)
//              └─ IrishLegalLLM-FineTunedDist1.6  (fine-tuned on base model)
//
// Checks compliance at EVERY hop and reports the full chain.
// ═══════════════════════════════════════════════════════════════════════════════
async function verifyProvenanceChain(startDistributionID) {
    const HR = "═".repeat(65);
    console.log(`\n${HR}`);
    console.log(`  Multi-hop Provenance Chain: dcat:${startDistributionID}`);
    console.log(HR);

    // ── Traverse the chain via SPARQL property path ───────────────────────────
    // First: find all upstream ResearchProducts
    const rpQuery = `${PREFIXES}
SELECT DISTINCT ?rp ?rpTitle ?rpLicence
WHERE {
  dcat:${startDistributionID} (aimd:derivedFromDistribution)* / aimd:derivedFromResearchProduct ?rp .
  OPTIONAL { ?rp dct:title ?rpTitle }
  OPTIONAL { ?rp dct:license ?rpLicence }
}`;
    const rpBindings = await sparqlSelect(rpQuery);

    // Second: find all intermediate distributions in the chain
    const chainQuery = `${PREFIXES}
SELECT DISTINCT ?dist ?distTitle ?distLicence
WHERE {
  dcat:${startDistributionID} (aimd:derivedFromDistribution)+ ?dist .
  OPTIONAL { ?dist dct:title ?distTitle }
  OPTIONAL { ?dist dct:license ?distLicence }
}`;
    const chainBindings = await sparqlSelect(chainQuery);

    console.log(`\n  Provenance chain for dcat:${startDistributionID}:\n`);

    if (rpBindings.length === 0 && chainBindings.length === 0) {
        console.log("  (No upstream provenance found — this is a root model with no declared derivation.)");
    }

    // Print upstream research products
    for (const b of rpBindings) {
        const title   = b.rpTitle?.value   || b.rp.value;
        const licence = b.rpLicence?.value || "(no licence)";
        console.log(`  📄 ResearchProduct: ${title}`);
        console.log(`     URI     : ${b.rp.value}`);
        console.log(`     Licence : ${licence}`);
        console.log();
    }

    // Print intermediate distributions
    for (const b of chainBindings) {
        const title   = b.distTitle?.value   || b.dist.value;
        const licence = b.distLicence?.value || "(no licence)";
        console.log(`  🤖 Upstream Distribution: ${title}`);
        console.log(`     URI     : ${b.dist.value}`);
        console.log(`     Licence : ${licence}`);
        console.log();
    }

    // ── Now run compliance checks for every distribution in the chain ─────────
    const allDists = [
        startDistributionID,
        ...chainBindings.map(b => {
            // Extract local name from URI, e.g. "dcat:IrishLegalLLMDist1.5" → "IrishLegalLLMDist1.5"
            const uri = b.dist.value;
            return uri.split(":").pop().split("/").pop().split("#").pop();
        }),
    ];

    const chainResults = [];
    for (const distID of allDists) {
        console.log(`\n  Checking compliance at hop: ${distID}`);
        const result = await verifyCompliance(distID);
        chainResults.push(result);
    }

    // ── Summary table ─────────────────────────────────────────────────────────
    console.log(`\n${HR}`);
    console.log("  Chain Compliance Summary");
    console.log(HR);
    for (const r of chainResults) {
        const icon = r.allCompliant ? "✅" : "❌";
        console.log(`  ${icon}  ${r.distributionID}`);
    }
    const allChainCompliant = chainResults.every(r => r.allCompliant);
    console.log(`\n  Chain overall: ${allChainCompliant ? "✅ FULLY COMPLIANT" : "❌ NON-COMPLIANT at one or more hops"}`);
    console.log(`${HR}\n`);

    return chainResults;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════════════

const academicCatalogue = [
    { catID: "TCD-TARA", description: "TCD TARA Institutional Repository — open access research outputs", publisher: "Trinity College Dublin" },
];

const researchProducts = [
    {
        id: "tara-paper-001", title: "Bias in NLP Models: A Systematic Review",
        creator: "Dr. Jane Murphy", issued: "2023-06-15",
        description: "Comprehensive review of bias in NLP models.",
        doi: "10.5281/zenodo.12345", repoURL: "https://tara.tcd.ie/handle/12345/001",
        licenceURI: "https://example.com/policy/OpenAccessAcademicLicence",
        keyword: "NLP, bias, AI, machine learning",
    },
    {
        id: "tara-dataset-002", title: "Irish Legal Corpus — Open Access",
        creator: "Prof. Aoife Walsh", issued: "2022-11-20",
        description: "A curated corpus of Irish legislative and court documents.",
        doi: "10.5281/zenodo.67890", repoURL: "https://tara.tcd.ie/handle/12345/002",
        licenceURI: "https://example.com/policy/OpenAccessAcademicLicence",
        keyword: "legal NLP, Irish law, corpus",
    },
];

// ── AI Model Resources ────────────────────────────────────────────────────────
const aiModelResources = [
    {
        resID: "facialrecognitionID", creator: "Meta", title: "facial-recog", date: "2024-03-10",
        desc: "Facial recognition model", domain: "Law Enforcement", purpose: "Facial Recognition",
        capability: "Match face with database", user: "Law Enforcement", subject: "Crime Suspects",
        modelCardURL: "https://huggingface.co/meta/facial-recog/blob/main/README.md",
        datasetCardURL: "https://huggingface.co/datasets/meta/face-db",
        biasReportURL: "https://huggingface.co/meta/facial-recog/blob/main/bias_report.pdf",
        trainingDataSummaryURL: "https://huggingface.co/meta/facial-recog/blob/main/training_data.md",
        riskAssessmentURL: "https://huggingface.co/meta/facial-recog/blob/main/risk_assessment.pdf",
    },
    {
        resID: "texttospeechID", creator: "Google", title: "text-to-speech", date: "2024-03-09",
        desc: "Text to speech model", domain: "Communication", purpose: "Text to Speech",
        capability: "Generate speech from text", user: "Mute Persons", subject: "Language Learner",
        modelCardURL: "https://huggingface.co/google/tts/blob/main/README.md",
        datasetCardURL: "https://huggingface.co/datasets/google/speech-corpus",
        biasReportURL: "https://huggingface.co/google/tts/blob/main/bias_report.pdf",
        trainingDataSummaryURL: "https://huggingface.co/google/tts/blob/main/training_data.md",
        riskAssessmentURL: "https://huggingface.co/google/tts/blob/main/risk_assessment.pdf",
    },
    {
        resID: "image-classificationID", creator: "Microsoft", title: "image-classification", date: "2024-03-08",
        desc: "Biomedical scan tumour classifier", domain: "Healthcare", purpose: "Tumor Classification",
        capability: "Classify tumors", user: "Radiologist", subject: "Hospital Patients",
        modelCardURL: "https://huggingface.co/microsoft/biomedical-classifier/blob/main/README.md",
        datasetCardURL: "https://huggingface.co/datasets/microsoft/scan-data",
        biasReportURL: "https://huggingface.co/microsoft/biomedical-classifier/blob/main/bias_report.pdf",
        trainingDataSummaryURL: "https://huggingface.co/microsoft/biomedical-classifier/blob/main/training_data.md",
        riskAssessmentURL: "https://huggingface.co/microsoft/biomedical-classifier/blob/main/risk_assessment.pdf",
    },
    {
        // Deliberately non-compliant — to demonstrate the checker
        resID: "textgenID", creator: "anon123", title: "TextGen-QA", date: "2024-03-01",
        desc: "Question Answering Model — trained on TCD TARA corpus",
        domain: "Retail", purpose: "Customer Service", capability: "QA", user: "Retail", subject: "Customers",
        modelCardURL: null, datasetCardURL: null, biasReportURL: null,
        trainingDataSummaryURL: null, riskAssessmentURL: null,
    },
    {
        resID: "legal-llm-001", creator: "LegalAI Ltd", title: "IrishLegalLLM", date: "2025-01-15",
        desc: "LLM fine-tuned on Irish Legal Corpus", domain: "Legal", purpose: "Legal Document Analysis",
        capability: "Summarise Irish legislation", user: "Legal Professionals", subject: "Irish Practitioners",
        modelCardURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/README.md",
        datasetCardURL: "https://huggingface.co/datasets/legalai/irish-legal-corpus",
        biasReportURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/bias_report.pdf",
        trainingDataSummaryURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/training_data.md",
        riskAssessmentURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/risk_assessment.pdf",
    },
    {
        // Fine-tuned model — second hop in provenance chain
        resID: "legal-llm-finetuned-001", creator: "LegalTech Startup", title: "IrishLegalLLM-ContractAnalysis", date: "2025-06-01",
        desc: "IrishLegalLLM further fine-tuned for contract analysis", domain: "Legal", purpose: "Contract Analysis",
        capability: "Identify clauses and risks in contracts", user: "Solicitors", subject: "Contract Parties",
        modelCardURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/README.md",
        datasetCardURL: "https://huggingface.co/datasets/legaltech/contracts",
        biasReportURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/bias_report.pdf",
        trainingDataSummaryURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/training_data.md",
        riskAssessmentURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/risk_assessment.pdf",
    },
];

// ── CO2 Disclosures ───────────────────────────────────────────────────────────
const co2Disclosures = {
    "FacialRecog_CO2": {
        kgCO2eq: 1200, energyKWhTotal: 5000, trainingHardware: "NVIDIA A100 x 16",
        trainingDurationHours: 720, cloudRegion: "us-east-1", gridCarbonIntensity: 420,
        emissionsScope: "training", reportingStandard: "CodeCarbon v2",
        co2MeasurementURL: "https://huggingface.co/meta/facial-recog/blob/main/co2_report.json",
    },
    "TextToSpeech_CO2": {
        kgCO2eq: 430, energyKWhTotal: 1800, trainingHardware: "NVIDIA V100 x 8",
        trainingDurationHours: 240, cloudRegion: "eu-west-1", gridCarbonIntensity: 233,
        emissionsScope: "training+inference", reportingStandard: "ML CO2 Impact",
        co2MeasurementURL: "https://huggingface.co/google/tts/blob/main/co2_report.json",
    },
    "BiomedImaging_CO2": {
        kgCO2eq: 620, energyKWhTotal: 2600, trainingHardware: "NVIDIA A100 x 8",
        trainingDurationHours: 360, cloudRegion: "eu-west-2", gridCarbonIntensity: 256,
        emissionsScope: "training", reportingStandard: "CodeCarbon v2",
        co2MeasurementURL: "https://huggingface.co/microsoft/biomedical-classifier/blob/main/co2_report.json",
    },
    "IrishLegalLLM_CO2": {
        kgCO2eq: 890, energyKWhTotal: 3700, trainingHardware: "NVIDIA A100 x 8",
        trainingDurationHours: 480, cloudRegion: "eu-west-1", gridCarbonIntensity: 233,
        emissionsScope: "training", reportingStandard: "CodeCarbon v2",
        co2MeasurementURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/co2_report.json",
    },
    "LegalLLMFineTuned_CO2": {
        kgCO2eq: 95, energyKWhTotal: 400, trainingHardware: "NVIDIA A10 x 4",
        trainingDurationHours: 48, cloudRegion: "eu-west-1", gridCarbonIntensity: 233,
        emissionsScope: "training", reportingStandard: "CodeCarbon v2",
        co2MeasurementURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/co2_report.json",
    },
};

// ── Copyright Policies ────────────────────────────────────────────────────────
const copyrightPolicies = {
    "FacialRecog_CP": {
        optOutMechanism: "robots.txt + Spawning AI opt-out registry",
        rightsHolderRegistry: "https://huggingface.co/meta/facial-recog/blob/main/rights_registry.json",
        tdmWaiver: "DSM Directive Art. 4 TDM exception",
        openAccessSourcesOnly: false,
        ccSignalsCompliant: true,
        copyrightPolicyDocURL: "https://huggingface.co/meta/facial-recog/blob/main/copyright_policy.pdf",
    },
    "IrishLegalLLM_CP": {
        optOutMechanism: "Open-access only — DSM Art. 4 applies; no web-crawl opt-out needed",
        rightsHolderRegistry: "https://tara.tcd.ie/handle/12345/002/rights",
        tdmWaiver: "CC-BY TDM clause; DSM Art. 4 TDM exception",
        openAccessSourcesOnly: true,
        ccSignalsCompliant: true,
        copyrightPolicyDocURL: "https://huggingface.co/legalai/irish-legal-llm/blob/main/copyright_policy.pdf",
    },
    "LegalLLMFineTuned_CP": {
        optOutMechanism: "Inherited from parent model IrishLegalLLMDist1.5",
        rightsHolderRegistry: "https://huggingface.co/legaltech/contract-analysis/blob/main/rights_registry.json",
        tdmWaiver: "CC-BY TDM clause; inherits parent model waiver",
        openAccessSourcesOnly: true,
        ccSignalsCompliant: true,
        copyrightPolicyDocURL: "https://huggingface.co/legaltech/contract-analysis/blob/main/copyright_policy.pdf",
    },
};

// ── Distributions ─────────────────────────────────────────────────────────────
const distributions = [
    {
        distribution: "FacialRecognitionDist1.1", accessURL: "https://huggingface.co/meta/facial-recog",
        date: "2024-03-20", sourceRP: null, parentDist: null,
        co2ID: "FacialRecog_CO2", cpID: "FacialRecog_CP",
    },
    {
        distribution: "TextToSpeechDist1.2", accessURL: "https://huggingface.co/google/tts",
        date: "2024-03-17", sourceRP: null, parentDist: null,
        co2ID: "TextToSpeech_CO2", cpID: null,
    },
    {
        distribution: "BiomedicalImageClassifierDist1.3", accessURL: "https://huggingface.co/microsoft/biomedical-classifier",
        date: "2024-03-19", sourceRP: null, parentDist: null,
        co2ID: "BiomedImaging_CO2", cpID: null,
    },
    {
        // Deliberately non-compliant
        distribution: "TextGenDist1.4", accessURL: "https://huggingface.co/anon123/textgen-qa",
        date: "2024-03-18", sourceRP: "tara-paper-001", parentDist: null,
        co2ID: null, cpID: null,
    },
    {
        distribution: "IrishLegalLLMDist1.5", accessURL: "https://huggingface.co/legalai/irish-legal-llm",
        date: "2025-01-20", sourceRP: "tara-dataset-002", parentDist: null,
        co2ID: "IrishLegalLLM_CO2", cpID: "IrishLegalLLM_CP",
    },
    {
        // Fine-tuned from IrishLegalLLMDist1.5 — multi-hop provenance
        distribution: "LegalLLMContractAnalysisDist1.6", accessURL: "https://huggingface.co/legaltech/contract-analysis",
        date: "2025-06-10", sourceRP: null, parentDist: "IrishLegalLLMDist1.5",
        co2ID: "LegalLLMFineTuned_CO2", cpID: "LegalLLMFineTuned_CP",
    },
];

const policies = [
    { policy: "FacialRecogLicence",        accessURL: "https://raw.githubusercontent.com/ci2me/AI-Model-Distribution-ODRL-Profile/main/HighRiskAILicence.ttl" },
    { policy: "TextToSpeechLicence",       accessURL: "https://raw.githubusercontent.com/ci2me/AI-Model-Distribution-ODRL-Profile/main/GPAILicence.ttl" },
    { policy: "ImagingLicence",            accessURL: "https://raw.githubusercontent.com/ci2me/AI-Model-Distribution-ODRL-Profile/main/HighRiskAILicence.ttl" },
    { policy: "TextGenLicence",            accessURL: "https://example.com/policy/OpenAccessAcademicLicence" },
    { policy: "OpenAccessAcademicLicence", accessURL: "https://example.com/policy/OpenAccessAcademicLicence" },
];

const usage = [
    { usage: "UsageID0001", organisation: "MacroHard",         date: "2024-04-03", accessURL: "https://example.com" },
    { usage: "UsageID0002", organisation: "LegalAI Ltd",       date: "2025-02-01", accessURL: "https://legalai.example.com" },
    { usage: "UsageID0003", organisation: "LegalTech Startup", date: "2025-06-15", accessURL: "https://legaltech.example.com" },
];

const resource1 = [{
    resID: "SportsBettingCustServiceID", creator: "MacroHard",
    title: "SportsBettingCustService001", date: "2024-04-03",
    desc: "Fine-tuned for sports betting questions", domain: "Retail",
    purpose: "Customer Assistance", capability: "Answer betting questions",
    user: "Bookmakers", subject: "Gambling Customers",
    modelCardURL: "https://huggingface.co/macrohard/sports-betting/blob/main/README.md",
    datasetCardURL: null, biasReportURL: null, trainingDataSummaryURL: null, riskAssessmentURL: null,
}];

const policy1 = [
    { policy: "GPAILicence", accessURL: "https://raw.githubusercontent.com/ci2me/AI-Model-Distribution-ODRL-Profile/main/GPAILicence.ttl" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
(async () => {

    // ── 1. Policy search (Cian's original) ────────────────────────────────────
    const dists = await searchDistributionByPolicy("http://www.w3.org/ns/odrl/2/TextToSpeechLicence");
    console.log(dists.length ? `Distributions with TTS policy: ${dists}` : "No distributions found for TTS policy.");

    // ── 2. Catalogues ─────────────────────────────────────────────────────────
    await insertCatalogue("CompA", "A catalog of open source AI models", "OpenSourceAILtd");
    for (const c of academicCatalogue) await insertCatalogue(c.catID, c.description, c.publisher);

    // ── 3. ResearchProducts ───────────────────────────────────────────────────
    for (const rp of researchProducts) {
        await insertResearchProduct(rp);
        await linkResearchProductToCatalogue("TCD-TARA", rp.id);
    }

    // ── 4. AI Model Resources ─────────────────────────────────────────────────
    for (const r of aiModelResources) await insertAIModelResource(r);

    // ── 5. CO2 Disclosures ────────────────────────────────────────────────────
    for (const [id, data] of Object.entries(co2Disclosures)) {
        await insertCO2Disclosure(id, data);
    }

    // ── 6. Copyright Policies ─────────────────────────────────────────────────
    for (const [id, data] of Object.entries(copyrightPolicies)) {
        await insertCopyrightPolicy(id, data);
    }

    // ── 7. Distributions ──────────────────────────────────────────────────────
    for (const d of distributions) {
        await insertDistribution(d.distribution, d.accessURL, d.date, {
            sourceResearchProductID: d.sourceRP,
            parentDistributionID:    d.parentDist,
            co2DisclosureID:         d.co2ID,
            copyrightPolicyNodeID:   d.cpID,
        });
    }

    // ── 8. Relationships ──────────────────────────────────────────────────────
    for (const d of distributions) await insertRelationship("CompA", d.distribution);
    for (const r of aiModelResources) await insertRelationship("CompA", r.resID);
    for (let i = 0; i < Math.min(aiModelResources.length, distributions.length); i++) {
        await insertRelationship(aiModelResources[i].resID, distributions[i].distribution);
    }
    await linkDistributionToResearchProduct("TextGenDist1.4",    "tara-paper-001");
    await linkDistributionToResearchProduct("IrishLegalLLMDist1.5", "tara-dataset-002");

    // ── 9. Policies ───────────────────────────────────────────────────────────
    for (const p of policies) await insertPolicy(p.policy, p.accessURL);
    for (let i = 0; i < Math.min(policies.length, distributions.length); i++) {
        await assignPolicy(distributions[i].distribution, policies[i].policy);
    }

    // ── 10. Usage ─────────────────────────────────────────────────────────────
    for (const u of usage) await insertUsage(u.usage, u.organisation, u.date, u.accessURL);
    for (const u of usage) {
        for (const d of distributions) {
            if (d.distribution === "TextGenDist1.4") await assignUsage(d.distribution, u.usage);
        }
    }
    for (const r of resource1) await insertAIModelResource(r);
    for (const u of usage) for (const r of resource1) await insertUsageHasResource(u.usage, r.resID);
    for (const p of policy1) await insertPolicy(p.policy, p.accessURL);
    for (const p of policy1) for (const r of resource1) await assignPolicy(r.resID, p.policy);

    // ── 11. COMPLIANCE CHECKS ─────────────────────────────────────────────────
    console.log("\n\n" + "▓".repeat(65));
    console.log("  COMPLIANCE VERIFICATION RUNS");
    console.log("▓".repeat(65));

    // Compliant — full CO2 + copyright disclosure
    await verifyCompliance("IrishLegalLLMDist1.5");

    // Non-compliant — missing almost everything
    await verifyCompliance("TextGenDist1.4");

    // ── 12. MULTI-HOP PROVENANCE CHAIN ────────────────────────────────────────
    console.log("\n\n" + "▓".repeat(65));
    console.log("  MULTI-HOP PROVENANCE CHAIN VERIFICATION");
    console.log("▓".repeat(65));

    // Trace: tara-dataset-002 → IrishLegalLLMDist1.5 → LegalLLMContractAnalysisDist1.6
    await verifyProvenanceChain("LegalLLMContractAnalysisDist1.6");

    console.log("Done.");
})();