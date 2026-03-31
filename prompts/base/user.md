Analyze IMS {{ ims_no }} as if you are the incident commander preparing a technically defensible incident brief.

Do not give a generic summary. Force yourself to reason from evidence, challenge weak assumptions, and identify what is actually knowable from the data.

Bundled data:

`basic_info`
{{ basic_info | to_pretty_json }}

`ims_info`
{{ ims_info | to_pretty_json }}

`host_info`
{{ host_info | to_pretty_json }}

`initial_into`
{{ initial_into | to_pretty_json }}

`dump_info`
{{ dump_info | to_pretty_json }}

Your task:
1. Extract the most operationally important facts.
2. Identify the strongest incident signals, not just all available details.
3. Explain what those signals imply.
4. Detect contradictions, ambiguity, or missing evidence.
5. Produce ranked hypotheses, not an unstructured idea list.
6. Recommend the next actions that would most reduce uncertainty or mitigate impact.

Be strict:
- If a claim is not supported by the JSON, do not make it.
- If the evidence is mixed, say that directly.
- If one hypothesis is weak, say why it is weak.
- If the data suggests a likely failure path, explain that path step by step.
- If host metrics, timestamps, or notes change the interpretation, call that out explicitly.

In the reasoning section, actively try to answer:
- What is happening?
- Why is it probably happening?
- What evidence best supports that view?
- What evidence could point somewhere else?
- What is the most dangerous wrong assumption an operator might make here?

Return the answer in this exact structure:

## Situation Summary
- 3 to 5 bullets

## Critical Evidence
- Evidence item

## Reasoning Chain
1. Step 1
2. Step 2
3. Step 3

## Ranked Hypotheses
1. Hypothesis
   Confidence: High / Medium / Low
   Supporting evidence:
   Weakness or missing evidence:

## Risks and Operational Impact
- Risk item

## Highest-Value Next Actions
1. Action
2. Action
3. Action

## Final Assessment
- A short conclusion grounded in the evidence
