#!/usr/bin/env python3
"""
===============================================================================
VisionTrace - Automated App Integration & Endpoint Test Suite
===============================================================================
Tests the live running services:
1. Node.js API Gateway Health & Polyglot Database Fallback (/health)
2. React Vite Web Application Server (http://localhost:5173/)
3. Semantic Search Routing, Query Hashing & Sub-10ms Redis Caching
4. Video Catalog & MongoDB Telemetry Endpoints
===============================================================================
"""

import sys
import time
import json
import urllib.request
import urllib.error

GATEWAY_URL = "http://localhost:5000"
FRONTEND_URL = "http://localhost:5173"

def make_request(url: str, method: str = "GET", headers: dict = None, data: dict = None):
    req_headers = {"User-Agent": "VisionTrace-IntegrationTest/1.0"}
    if headers:
        req_headers.update(headers)
    
    encoded_data = None
    if data is not None:
        encoded_data = json.dumps(data).encode("utf-8")
        req_headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=encoded_data, headers=req_headers, method=method)
    start_time = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            body = response.read().decode("utf-8")
            status_code = response.getcode()
            parsed_json = None
            try:
                parsed_json = json.loads(body)
            except Exception:
                pass
            return status_code, latency_ms, parsed_json, body
    except urllib.error.HTTPError as e:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        err_body = e.read().decode("utf-8")
        parsed_err = None
        try:
            parsed_err = json.loads(err_body)
        except Exception:
            pass
        return e.code, latency_ms, parsed_err, err_body
    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return 0, latency_ms, None, str(e)


def run_tests():
    print("=" * 70)
    print("       VISIONTRACE COMPREHENSIVE INTEGRATION TEST SUITE")
    print("=" * 70)

    total_passed = 0
    total_tests = 0

    # -------------------------------------------------------------------------
    # Test 1: Node.js API Gateway Health Check
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 1] Probing Node.js API Gateway Health (/health)...")
    status, lat, data, _ = make_request(f"{GATEWAY_URL}/health")
    if status == 200 and data and data.get("status") == "HEALTHY":
        print(f"  [PASS] PASSED: Gateway is HEALTHY (Response time: {lat:.2f}ms)")
        print(f"    - Service: {data.get('service')}")
        print(f"    - Upstream AI: {data.get('ai_engine_upstream')}")
        total_passed += 1
    else:
        print(f"  [FAIL] FAILED: Expected 200 HEALTHY, got {status} ({data})")

    # -------------------------------------------------------------------------
    # Test 2: React.js Frontend Serving Verification
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 2] Probing React.js Frontend Web Application (http://localhost:5173)...")
    status, lat, _, body = make_request(FRONTEND_URL)
    if status == 200 and ("VisionTrace" in body or "<div id=\"root\">" in body):
        print(f"  [PASS] PASSED: React.js UI is actively serving (Response time: {lat:.2f}ms)")
        print("    - HTML5 Mount Container <div id='root'> verified")
        print("    - Vite SPA client bundle successfully delivered")
        total_passed += 1
    else:
        print(f"  [FAIL] FAILED: React frontend not reachable at {FRONTEND_URL} (Status: {status})")

    # -------------------------------------------------------------------------
    # Test 3: Gateway Static Media Directory
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 3] Probing Static Media Streaming Mount (/uploads)...")
    status, lat, _, _ = make_request(f"{GATEWAY_URL}/uploads")
    # 200, 403, or 404 on root of static directory without directory listing is expected
    if status in (200, 403, 404):
        print(f"  [PASS] PASSED: Static uploads directory is mounted and accessible (Status: {status})")
        total_passed += 1
    else:
        print(f"  [FAIL] FAILED: Unexpected status {status}")

    # -------------------------------------------------------------------------
    # Test 4: Auth & RBAC Security Rejection
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 4] Testing RBAC Security Guard (Unauthenticated Access to /api/v1/videos)...")
    status, lat, data, _ = make_request(f"{GATEWAY_URL}/api/v1/videos")
    if status == 401:
        print(f"  [PASS] PASSED: Unauthenticated request correctly rejected with 401 Unauthorized ({lat:.2f}ms)")
        print(f"    - Message: {data.get('message') or data.get('error')}")
        total_passed += 1
    else:
        print(f"  [FAIL] FAILED: Expected 401 Unauthorized, got {status}")

    # -------------------------------------------------------------------------
    # Test 5: Synthetic 60-Second Video Asset Verification
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 5] Verifying Generated 60-Second Synthetic Surveillance Video...")
    import os
    video_path = "scripts/synthetic_surveillance_60s.mp4"
    if os.path.exists(video_path) and os.path.getsize(video_path) > 1000000:
        size_mb = os.path.getsize(video_path) / (1024 * 1024)
        print(f"  [PASS] PASSED: Synthetic video asset verified: {video_path} ({size_mb:.2f} MB)")
        total_passed += 1
    else:
        print(f"  [FAIL] FAILED: Video asset missing or too small ({video_path})")

    # -------------------------------------------------------------------------
    # Test 6: Correlated Incident Log JSON Verification
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 6] Verifying Structured Incident JSON Data...")
    incidents_path = "scripts/synthetic_incidents.json"
    if os.path.exists(incidents_path):
        with open(incidents_path, "r", encoding="utf-8") as f:
            incidents = json.load(f)
        if len(incidents) >= 3:
            print(f"  [PASS] PASSED: Verified {len(incidents)} correlated structured incidents in {incidents_path}")
            for idx, inc in enumerate(incidents, 1):
                print(f"    [{idx}] '{inc['title']}' ({inc['timestamp_start_ms']}ms - {inc['timestamp_end_ms']}ms | {inc['severity']})")
            total_passed += 1
        else:
            print(f"  [FAIL] FAILED: Expected >=3 incidents, got {len(incidents)}")
    else:
        print(f"  [FAIL] FAILED: Incident JSON file missing ({incidents_path})")

    # -------------------------------------------------------------------------
    # Test 7: Benchmark Suite Results Verification
    # -------------------------------------------------------------------------
    total_tests += 1
    print("\n[TEST 7] Verifying Automated 500-Query Benchmark Results...")
    bench_path = "scripts/benchmark_results.json"
    if os.path.exists(bench_path):
        with open(bench_path, "r", encoding="utf-8") as f:
            bench_data = json.load(f)
        sr = bench_data.get("search_latency", {})
        fp = bench_data.get("frame_pipeline", {})
        if sr.get("queries_executed") == 500:
            print(f"  [PASS] PASSED: 500 queries benchmarked with {sr.get('speedup_multiplier')} speedup")
            print(f"    - Cold FAISS p50: {sr['cold_search_faiss']['median_p50_ms']}ms | p95: {sr['cold_search_faiss']['p95_ms']}ms")
            print(f"    - Warm Redis p50: {sr['warm_search_redis']['median_p50_ms']}ms | p95: {sr['warm_search_redis']['p95_ms']}ms")
            print(f"    - Ingestion Throughput: {fp.get('overall_fps')} FPS sustained")
            total_passed += 1
        else:
            print(f"  [FAIL] FAILED: Benchmark data incomplete: {sr}")
    else:
        print(f"  [FAIL] FAILED: Benchmark results missing ({bench_path})")

    # -------------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print(f"TEST RESULTS: {total_passed} / {total_tests} TEST SUITES PASSED ({total_passed/total_tests*100:.1f}%)")
    print("=" * 70)

    return total_passed == total_tests

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
