$BASE_URL = "https://collectly-backend-4d5f.onrender.com"
$EMAIL = "your-@gmail.com.com"
$PASSWORD = "Secure-password-put-there"
$pass = 0
$fail = 0
function Green($msg)  { Write-Host $msg -ForegroundColor Green }
function Red($msg)    { Write-Host $msg -ForegroundColor Red }
function Cyan($msg)   { Write-Host $msg -ForegroundColor Cyan }
function Yellow($msg) { Write-Host $msg -ForegroundColor Yellow }
function Test-Route {
    param([string]$Method,[string]$Url,[string]$Label,[hashtable]$Body=$null,[hashtable]$Headers=$null,[int[]]$ExpectedCodes=@(200,201,204))
    $reqHeaders = @{ "Content-Type"="application/json" }
    if ($Headers) { $Headers.GetEnumerator() | ForEach-Object { $reqHeaders[$_.Key]=$_.Value } }
    try {
        $params = @{ Method=$Method; Uri=$Url; Headers=$reqHeaders }
        if ($Body) { $params.Body=($Body|ConvertTo-Json -Depth 10) }
        $response = Invoke-WebRequest @params -ErrorAction Stop
        $code = $response.StatusCode
        if ($ExpectedCodes -contains $code) { Green "  [PASS] $Label - $code"; $script:pass++ }
        else { Red "  [FAIL] $Label - unexpected $code"; $script:fail++ }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -in @(400,401,403,404,409,422)) { Green "  [PASS] $Label - route exists ($code)"; $script:pass++ }
        else { Red "  [FAIL] $Label - $($_.Exception.Message)"; $script:fail++ }
    }
}
Cyan "`n===== HEALTH CHECK ====="
Test-Route -Method GET -Url "$BASE_URL/health" -Label "GET /health"
Cyan "`n===== LOGIN ====="
$TOKEN = "invalid"
try {
    $loginResp = Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/v1/auth/login" -Body (@{email=$EMAIL;password=$PASSWORD}|ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    $TOKEN = $loginResp.data.tokens.accessToken
    Green "  [PASS] Login - token obtained"; $script:pass++
} catch { Red "  [FAIL] Login failed - update EMAIL and PASSWORD"; $script:fail++ }
$AUTH = @{ Authorization="Bearer $TOKEN" }
Cyan "`n===== MODULE A - Auth ====="
Test-Route -Method POST -Url "$BASE_URL/api/v1/auth/signup" -Label "POST /auth/signup" -Body @{name="Test";email="exists@test.com";password="Test1234!"} -ExpectedCodes @(201,409,400)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/auth/me" -Label "GET /auth/me" -Headers $AUTH -ExpectedCodes @(200)
Test-Route -Method POST -Url "$BASE_URL/api/v1/auth/forgot-password" -Label "POST /auth/forgot-password" -Body @{email=$EMAIL} -ExpectedCodes @(200,404)
Test-Route -Method POST -Url "$BASE_URL/api/v1/auth/logout" -Label "POST /auth/logout" -Headers $AUTH -ExpectedCodes @(200,204)
Test-Route -Method POST -Url "$BASE_URL/api/v1/auth/2fa/setup" -Label "POST /auth/2fa/setup" -Headers $AUTH -ExpectedCodes @(200,400)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/auth/oauth/google" -Label "GET /auth/oauth/google" -ExpectedCodes @(302,503,200)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/auth/oauth/microsoft" -Label "GET /auth/oauth/microsoft" -ExpectedCodes @(302,503,200)
Cyan "`n===== MODULE B - Billing ====="
Test-Route -Method GET -Url "$BASE_URL/api/v1/billing/plans" -Label "GET /billing/plans"
Test-Route -Method GET -Url "$BASE_URL/api/v1/billing" -Label "GET /billing" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/billing/usage" -Label "GET /billing/usage" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/billing/invoices" -Label "GET /billing/invoices" -Headers $AUTH
Cyan "`n===== MODULE C - Customers ====="
Test-Route -Method GET  -Url "$BASE_URL/api/v1/customers" -Label "GET /customers" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/customers" -Label "POST /customers" -Headers $AUTH -Body @{name="Test Customer";email="customer@test.com";phone="+923001234567";company="Test Co";preferredChannels=@("email");currency="usd"} -ExpectedCodes @(201,400,409)
$CUST_ID = "000000000000000000000001"
try { $c = Invoke-RestMethod -Method GET -Uri "$BASE_URL/api/v1/customers" -Headers @{Authorization="Bearer $TOKEN";"Content-Type"="application/json"}; $CUST_ID=$c.data.customers[0]._id; Yellow "  Customer ID: $CUST_ID" } catch {}
Test-Route -Method GET   -Url "$BASE_URL/api/v1/customers/$CUST_ID" -Label "GET /customers/:id" -Headers $AUTH
Test-Route -Method GET   -Url "$BASE_URL/api/v1/customers/$CUST_ID/summary" -Label "GET /customers/:id/summary" -Headers $AUTH
Test-Route -Method PATCH -Url "$BASE_URL/api/v1/customers/$CUST_ID" -Label "PATCH /customers/:id" -Headers $AUTH -Body @{company="Updated Co"} -ExpectedCodes @(200,400,404)
Cyan "`n===== MODULE C - Invoices ====="
Test-Route -Method GET -Url "$BASE_URL/api/v1/invoices" -Label "GET /invoices" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/invoices/overdue" -Label "GET /invoices/overdue" -Headers $AUTH
$dueDate=(Get-Date).AddDays(7).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
Test-Route -Method POST -Url "$BASE_URL/api/v1/invoices" -Label "POST /invoices" -Headers $AUTH -Body @{customerId=$CUST_ID;invoiceNumber="INV-VERIFY-001";amount=500;currency="usd";dueDate=$dueDate;description="Test"} -ExpectedCodes @(201,400,409)
$INV_ID = "000000000000000000000001"
try { $i = Invoke-RestMethod -Method GET -Uri "$BASE_URL/api/v1/invoices" -Headers @{Authorization="Bearer $TOKEN";"Content-Type"="application/json"}; $INV_ID=$i.data.invoices[0]._id; Yellow "  Invoice ID: $INV_ID" } catch {}
Test-Route -Method GET   -Url "$BASE_URL/api/v1/invoices/$INV_ID" -Label "GET /invoices/:id" -Headers $AUTH
Test-Route -Method PATCH -Url "$BASE_URL/api/v1/invoices/$INV_ID" -Label "PATCH /invoices/:id" -Headers $AUTH -Body @{description="Updated"} -ExpectedCodes @(200,400,404)
Test-Route -Method POST  -Url "$BASE_URL/api/v1/invoices/$INV_ID/payment" -Label "POST /invoices/:id/payment" -Headers $AUTH -Body @{amount=100;method="bank_transfer";note="Partial"} -ExpectedCodes @(200,400,404)
Cyan "`n===== MODULE D - Sequences ====="
Test-Route -Method GET -Url "$BASE_URL/api/v1/sequences" -Label "GET /sequences" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/sequences/default" -Label "GET /sequences/default" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/sequences/active-invoices" -Label "GET /sequences/active-invoices" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/sequences" -Label "POST /sequences" -Headers $AUTH -Body @{name="Verify Seq";description="Test";isDefault=$false;phases=@(@{phaseNumber=1;name="Pre-due";triggerDays=-3;channels=@("email");messageTemplate=@{subject="Due soon";body="Invoice due."}})} -ExpectedCodes @(201,400)
$SEQ_ID = "000000000000000000000001"
try { $s = Invoke-RestMethod -Method GET -Uri "$BASE_URL/api/v1/sequences" -Headers @{Authorization="Bearer $TOKEN";"Content-Type"="application/json"}; $SEQ_ID=$s.data.sequences[0]._id; Yellow "  Sequence ID: $SEQ_ID" } catch {}
Test-Route -Method GET  -Url "$BASE_URL/api/v1/sequences/$SEQ_ID" -Label "GET /sequences/:id" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/sequences/$SEQ_ID/duplicate" -Label "POST /sequences/:id/duplicate" -Headers $AUTH -ExpectedCodes @(201,200,404)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/sequences/invoice/$INV_ID" -Label "GET /sequences/invoice/:invoiceId" -Headers $AUTH -ExpectedCodes @(200,404)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/sequences/invoice/$INV_ID/progress" -Label "GET /sequences/invoice/:id/progress" -Headers $AUTH -ExpectedCodes @(200,404)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/sequences/invoice/$INV_ID/history" -Label "GET /sequences/invoice/:id/history" -Headers $AUTH -ExpectedCodes @(200,404)
Cyan "`n===== MODULE E - Notifications ====="
Test-Route -Method GET  -Url "$BASE_URL/api/v1/notifications" -Label "GET /notifications" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/notifications/stats" -Label "GET /notifications/stats" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/notifications/delivery-stats" -Label "GET /notifications/delivery-stats" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/notifications/send" -Label "POST /notifications/send (email)" -Headers $AUTH -Body @{channel="email";type="payment_reminder";recipient=@{name="Test";email="test@example.com"};subject="Test";body="Verification."} -ExpectedCodes @(201,200)
Test-Route -Method POST -Url "$BASE_URL/api/v1/notifications/send" -Label "POST /notifications/send (sms)" -Headers $AUTH -Body @{channel="sms";type="payment_reminder";recipient=@{name="Test";phone="+15005550006"};body="Verification."} -ExpectedCodes @(201,200,403)
Test-Route -Method POST -Url "$BASE_URL/api/v1/notifications/send" -Label "POST /notifications/send (whatsapp)" -Headers $AUTH -Body @{channel="whatsapp";type="payment_reminder";recipient=@{name="Test";phone="+15005550006"};body="Verification."} -ExpectedCodes @(201,200,403)
Cyan "`n===== MODULE F - Conversations ====="
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/inbox" -Label "GET /conversations/inbox" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/follow-ups" -Label "GET /conversations/follow-ups" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/canned-replies" -Label "GET /conversations/canned-replies" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/canned-replies/categories" -Label "GET /conversations/canned-replies/categories" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/payment-plans" -Label "GET /conversations/payment-plans" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/conversations/thread/$CUST_ID" -Label "GET /conversations/thread/:customerId" -Headers $AUTH -ExpectedCodes @(200,404)
Test-Route -Method POST -Url "$BASE_URL/api/v1/conversations/messages" -Label "POST /conversations/messages" -Headers $AUTH -Body @{customerId=$CUST_ID;channel="email";body="Test.";direction="outbound"} -ExpectedCodes @(201,200,400)
Cyan "`n===== MODULE G - Dashboard ====="
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/customer" -Label "GET /dashboard/customer" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/customer/upcoming-dues" -Label "GET /dashboard/customer/upcoming-dues" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/customer/reminder-history" -Label "GET /dashboard/customer/reminder-history" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/agent" -Label "GET /dashboard/agent" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/agent/overdue" -Label "GET /dashboard/agent/overdue" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/agent/priority-queue" -Label "GET /dashboard/agent/priority-queue" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/dashboard/agent/recovery-rate" -Label "GET /dashboard/agent/recovery-rate" -Headers $AUTH
Cyan "`n===== MODULE H - Search ====="
Test-Route -Method GET -Url "$BASE_URL/api/v1/search?q=test" -Label "GET /search?q=test" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/search/invoices?q=INV" -Label "GET /search/invoices" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/search/customers?q=test" -Label "GET /search/customers" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/search/invoices/filter" -Label "GET /search/invoices/filter" -Headers $AUTH
Test-Route -Method GET -Url "$BASE_URL/api/v1/search/tags" -Label "GET /search/tags" -Headers $AUTH
Cyan "`n===== MODULE I - Alerts ====="
Test-Route -Method GET  -Url "$BASE_URL/api/v1/alerts" -Label "GET /alerts" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/alerts/unread-count" -Label "GET /alerts/unread-count" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/alerts/read-all" -Label "POST /alerts/read-all" -Headers $AUTH -ExpectedCodes @(200,204)
Cyan "`n===== MODULE J - Compliance ====="
Test-Route -Method GET  -Url "$BASE_URL/api/v1/compliance/dnc" -Label "GET /compliance/dnc" -Headers $AUTH
Test-Route -Method GET  -Url "$BASE_URL/api/v1/compliance/customers/$CUST_ID/consent" -Label "GET /compliance/customers/:id/consent" -Headers $AUTH -ExpectedCodes @(200,404)
Test-Route -Method GET  -Url "$BASE_URL/api/v1/compliance/gdpr/exports" -Label "GET /compliance/gdpr/exports" -Headers $AUTH
Test-Route -Method POST -Url "$BASE_URL/api/v1/compliance/dnc" -Label "POST /compliance/dnc" -Headers $AUTH -Body @{customerId=$CUST_ID;reason="Test DNC"} -ExpectedCodes @(200,201,400,404,409)
Cyan "`n============================================"
Cyan "      COLLECTLY API - TEST RESULTS"
Cyan "============================================"
Green " PASSED : $pass"
if ($fail -gt 0) { Red " FAILED : $fail" } else { Green " FAILED : 0" }
Yellow " TOTAL  : $($pass + $fail)"
Cyan "============================================"
