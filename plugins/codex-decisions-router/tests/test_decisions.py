import math
import unittest

from codex_decisions_router.decisions import InvalidResponse, build_request, canonical, parse_response, strict_json
from codex_decisions_router.policy import PRESETS
from helpers import answer, clone, refusal, request


class DecisionsContractTests(unittest.TestCase):
    def test_small_whitelist_payload(self):
        body = build_request(request(), PRESETS)
        self.assertEqual(set(body), {"model", "input", "questions"})
        self.assertEqual(len(body["questions"]), 1)
        self.assertLess(len(canonical(body).encode()), 8192)
        data = strict_json(body["input"])
        self.assertEqual(set(data), set(request().features.model_dump()) | {"optimization_goal"})
        self.assertNotIn("host", data)
        self.assertNotIn("attempt", data)
        self.assertEqual(len(body["questions"][0]["choices"]), 7)

    def test_valid_response_and_future_envelope(self):
        data = answer()
        data["future_metadata"] = {"ignored": True}
        self.assertEqual(parse_response(data, PRESETS).choice, "sol_balanced")
        self.assertEqual(parse_response(refusal(), PRESETS).kind, "refusal")
        self.assertEqual(parse_response(answer("abstain"), PRESETS).choice, "abstain")

    def test_reject_union_and_answer_shape(self):
        mutations = [lambda d: d.update(answers=[]), lambda d: d["answers"].append(clone(d["answers"][0])),
                     lambda d: d["answers"][0].update(name="other"),
                     lambda d: d["answers"][0].update(type="predicate"),
                     lambda d: d["answers"][0].update(choice=True),
                     lambda d: d["answers"][0].update(choice="arbitrary-model"),
                     lambda d: d["answers"][0].update(command="NEVER_ECHO"),
                     lambda d: d.update(model="other"), lambda d: d.pop("usage")]
        for mutate in mutations:
            data = answer()
            mutate(data)
            with self.assertRaises(InvalidResponse):
                parse_response(data, PRESETS)
        data = refusal()
        data["answers"][0]["choice"] = "sol_deep"
        self.assertEqual(parse_response(data, PRESETS).kind, "refusal")

    def test_bad_probability_and_confidence(self):
        for value in (math.nan, math.inf, -0.1, 1.1, True, "0.9", None):
            for field in ("confidence", "probability"):
                data = answer()
                target = data["answers"][0] if field == "confidence" else data["answers"][0]["probabilities"][0]
                target[field] = value
                with self.assertRaises(InvalidResponse):
                    parse_response(data, PRESETS)
        for mutation in ("duplicate", "missing", "sum", "boolean", "extra"):
            data = answer()
            values = data["answers"][0]["probabilities"]
            if mutation == "duplicate":
                values[0] = clone(values[1])
            elif mutation == "missing":
                values.pop()
            elif mutation == "sum":
                values[0]["probability"] = 0.5
            elif mutation == "boolean":
                values[0]["value"] = True
            else:
                values[0]["unexpected"] = "NEVER_ECHO"
            with self.assertRaises(InvalidResponse):
                parse_response(data, PRESETS)

    def test_json_rejects_duplicates_and_constants(self):
        for value in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{invalid', b'\xff'):
            with self.assertRaises(InvalidResponse):
                strict_json(value)
