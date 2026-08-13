/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * wms_sl_scan_ingest - the ingest endpoint (vertical slice, docs/09; T-3.1 in full).
 *
 * Deployed Available Without Login, under a dedicated least-privilege Execute As
 * Role (never Administrator, PF-36), with Audience including Online Form User
 * (PF-35). Same-origin: GET serves the page, POST is the JSON API (D-19).
 *
 * Flow (thin - business logic is in wms_lib_ingest):
 *   1. DEVICE TOKEN CHECK - the FIRST operation, before any record load (D-21).
 *      A hard-coded stub here per the slice spec; real per-device credential is
 *      D-21/T-3.6, out of the slice.
 *   2. parse batch -> validate each event -> create customrecord_wms_scan_event
 *      with externalid = client UUID (AD-04 layer 1). A duplicate fails with
 *      UNIQUE_RCRD_ID_REQD (PF-13) and is returned idempotent.
 *   3. trigger the committer on demand (task.MapReduceScriptTask, no deploymentId,
 *      PF-08).
 *   4. return a per-event result array in a 200 body (a Suitelet cannot set a
 *      non-200 status, PF-03).
 */
define(['N/record', 'N/task', 'N/log', './lib/wms_lib_ingest'], function (record, task, log, ingest) {
    'use strict';

    // SLICE STUB ONLY - replaced by the per-device credential of D-21/T-3.6.
    // Device auth beyond a hard-coded token is explicitly out of the slice (docs/09).
    var STUB_DEVICE_TOKEN = 'SLICE-STUB-DEVICE-TOKEN';

    var COMMITTER_SCRIPT_ID = 'customscript_wms_mr_committer';

    function json(response, statusBody) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });
        response.write({ output: JSON.stringify(statusBody) });
    }

    function deviceTokenValid(request) {
        // First operation - cheap, before any record load (D-21).
        var headerToken = request.headers ? request.headers['X-WMS-Device-Token'] : null;
        var token = headerToken;
        if (!token && request.body) {
            try {
                token = JSON.parse(request.body).deviceToken;
            } catch (e) {
                token = null;
            }
        }
        return token === STUB_DEVICE_TOKEN;
    }

    function writeEvent(event) {
        var rec = record.create({ type: 'customrecord_wms_scan_event' });
        rec.setValue({ fieldId: 'externalid', value: event.uuid });
        rec.setValue({ fieldId: 'custrecord_se_type', value: event.eventType });
        rec.setValue({ fieldId: 'custrecord_se_sku', value: event.item });
        rec.setValue({ fieldId: 'custrecord_se_qty', value: event.quantity });
        rec.setValue({ fieldId: 'custrecord_se_source_bin', value: event.bin });
        rec.setValue({ fieldId: 'custrecord_se_location', value: event.location });
        rec.setValue({ fieldId: 'custrecord_se_source_doc', value: event.sourceDocument });
        rec.setValue({ fieldId: 'custrecord_se_status', value: 'PENDING' });
        rec.setValue({ fieldId: 'custrecord_se_payload', value: JSON.stringify(event) });
        return String(rec.save());
    }

    function handlePost(request, response) {
        if (!deviceTokenValid(request)) {
            json(response, { ok: false, error: 'ERR_WMS_DEVICE_UNKNOWN' });
            return;
        }

        var events;
        try {
            events = ingest.parseBatch(JSON.parse(request.body));
        } catch (e) {
            json(response, { ok: false, error: e.name || 'ERR_WMS_BAD_REQUEST', message: e.message });
            return;
        }

        var results = events.map(function (event) {
            var verdict = ingest.validateScanEvent(event);
            if (!verdict.ok) {
                return { uuid: event && event.uuid, status: 'REJECTED', reasonCode: verdict.reasonCode, field: verdict.field };
            }
            try {
                var id = writeEvent(event);
                return { uuid: event.uuid, status: 'ACCEPTED', eventId: id };
            } catch (e) {
                var cls = ingest.classifyIngestError(e.name);
                if (cls.idempotent) {
                    return { uuid: event.uuid, status: 'ACCEPTED', idempotent: true };
                }
                return { uuid: event.uuid, status: cls.retryable ? 'RETRYABLE' : 'FAILED', error: e.name, message: e.message };
            }
        });

        var committerTriggered = false;
        try {
            task.create({ taskType: task.TaskType.MAP_REDUCE, scriptId: COMMITTER_SCRIPT_ID }).submit();
            committerTriggered = true;
        } catch (e) {
            // All committer deployments busy -> the scheduled fallback will sweep.
            // Not an error for the caller (AD-20).
            log.audit({ title: 'committer trigger deferred', details: e.name });
        }

        json(response, { ok: true, results: results, committerTriggered: committerTriggered });
    }

    function handleGet(request, response) {
        response.write({ output: PAGE_HTML });
    }

    function onRequest(context) {
        if (context.request.method === 'GET') {
            handleGet(context.request, context.response);
        } else {
            handlePost(context.request, context.response);
        }
    }

    // Minimal online-only page (Day 2). IndexedDB / offline queue is Day 5, out of
    // this pass. Client JS lives in this string (not a linted .js file).
    var PAGE_HTML = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>WMS Receipt (slice)</title>',
        '<style>body{font-family:system-ui;margin:1rem;max-width:28rem}',
        'label{display:block;margin:.6rem 0 .2rem}input{font-size:1.2rem;width:100%;padding:.5rem}',
        'button{font-size:1.2rem;padding:.7rem 1rem;margin-top:1rem;width:100%}',
        'pre{background:#f4f4f4;padding:.6rem;white-space:pre-wrap}</style></head><body>',
        '<h1>Receipt (slice)</h1>',
        '<label>PO number</label><input id="po">',
        '<label>Item internal id</label><input id="item">',
        '<label>Bin id</label><input id="bin">',
        '<label>Location id</label><input id="loc">',
        '<label>Quantity</label><input id="qty" type="number" inputmode="numeric">',
        '<button id="go">Submit</button><pre id="out"></pre>',
        '<script>',
        'document.getElementById("go").onclick=function(){',
        ' var ev={uuid:crypto.randomUUID(),eventType:"RECEIPT_PO",',
        '  sourceDocument:document.getElementById("po").value,',
        '  item:document.getElementById("item").value,',
        '  bin:document.getElementById("bin").value,',
        '  location:document.getElementById("loc").value,',
        '  quantity:Number(document.getElementById("qty").value)};',
        ' fetch(window.location.pathname+window.location.search,{method:"POST",',
        '  headers:{"Content-Type":"application/json","X-WMS-Device-Token":"' + STUB_DEVICE_TOKEN + '"},',
        '  body:JSON.stringify({deviceToken:"' + STUB_DEVICE_TOKEN + '",events:[ev]})})',
        '  .then(function(r){return r.json()}).then(function(d){',
        '   document.getElementById("out").textContent=JSON.stringify(d,null,2)})',
        '  .catch(function(e){document.getElementById("out").textContent=String(e)});',
        '};',
        '</script></body></html>',
    ].join('');

    return { onRequest: onRequest };
});
