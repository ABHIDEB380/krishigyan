$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://127.0.0.1:4173/"
$envFile = Join-Path $root ".env"
$geminiModel = if ($env:GEMINI_MODEL) { $env:GEMINI_MODEL } else { "gemini-2.5-flash" }
$officialDomains = @(".gov.in", ".nic.in", "myscheme.gov.in", "pmkisan.gov.in", "pmkusum.mnre.gov.in", "nabard.org")

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^([A-Z0-9_]+)=(.*)$" -and -not [Environment]::GetEnvironmentVariable($matches[1], "Process")) {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"', "'"), "Process")
    }
  }
}

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".svg" = "image/svg+xml"
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  if ($request.Url.AbsolutePath -eq "/api/chat" -and $request.HttpMethod -eq "POST") {
    $response.ContentType = "application/json; charset=utf-8"
    $apiKey = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "Process")

    if (-not $apiKey) {
      $buffer = [Text.Encoding]::UTF8.GetBytes('{"error":"Gemini API key is not configured."}')
      $response.StatusCode = 500
      $response.OutputStream.Write($buffer, 0, $buffer.Length)
      $response.Close()
      continue
    }

    try {
      $reader = [IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $messages = @($payload.messages)
      $recent = @($messages | Select-Object -Last 6)
      $contents = @()
      foreach ($message in $recent) {
        $role = if ($message.role -eq "assistant") { "model" } else { "user" }
        $text = [string]$message.text
        if ($text.Length -gt 900) { $text = $text.Substring(0, 900) }
        $contents += @{ role = $role; parts = @(@{ text = $text }) }
      }

      if ($contents.Count -eq 0) { throw "Empty message" }

      $today = Get-Date -Format "d MMMM yyyy"
      $body = @{
        systemInstruction = @{
          parts = @(@{
            text = "You are KrishiGyan AI Advisor for Indian farmers. Today's date is $today. Answer only questions about farming, farmer government schemes, subsidies, crop planning, livestock, fishery, dairy, poultry, irrigation, solar pumps, loans, organic farming, documents, and farm profit planning in India. For scheme recommendations, rely only on current official Indian government sources, such as .gov.in, .nic.in, myscheme.gov.in, agriculture department portals, state livestock/fishery/dairy/horticulture portals, PM-KUSUM, PM-Kisan, NABARD, and ministry pages. Do not rely on blogs, private websites, old PDFs, or unverified lists for scheme status. Do not present an expired, closed, or unverified scheme as active. If you cannot verify that a scheme is currently live from official sources, say that clearly and suggest checking the nearest agriculture/livestock/fishery department office. If the user asks outside agriculture or farmer benefits, politely say you can help only with farming and scheme guidance. Use simple farmer-friendly language. Be concise but useful. Prefer short bullet points when helpful. Mention application status, eligibility uncertainty, and official verification steps. Do not ask for sensitive personal data. Do not claim guaranteed approval."
          })
        }
        tools = @(@{ google_search = @{} })
        contents = $contents
        generationConfig = @{
          temperature = 0.35
          topP = 0.8
          maxOutputTokens = 420
        }
      } | ConvertTo-Json -Depth 12

      $uri = "https://generativelanguage.googleapis.com/v1beta/models/$geminiModel`:generateContent"
      $geminiResponse = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ "x-goog-api-key" = $apiKey } -ContentType "application/json" -Body $body
      $reply = ($geminiResponse.candidates[0].content.parts | ForEach-Object { $_.text }) -join ""
      if (-not $reply) { $reply = "I could not generate an answer right now. Please try again." }
      $sources = @()
      foreach ($chunk in @($geminiResponse.candidates[0].groundingMetadata.groundingChunks)) {
        if ($chunk.web.uri) {
          try {
            $hostName = ([Uri]$chunk.web.uri).Host.ToLowerInvariant()
            $isOfficial = $false
            foreach ($domain in $officialDomains) {
              if ($hostName.EndsWith($domain) -or $hostName -eq $domain) { $isOfficial = $true }
            }
            if ($isOfficial) {
              $sources += @{ title = if ($chunk.web.title) { $chunk.web.title } else { "Source" }; url = $chunk.web.uri }
            }
          } catch {}
        }
      }
      $json = @{ reply = $reply.Trim(); sources = @($sources | Select-Object -First 5) } | ConvertTo-Json -Depth 6
      $buffer = [Text.Encoding]::UTF8.GetBytes($json)
      $response.StatusCode = 200
      $response.OutputStream.Write($buffer, 0, $buffer.Length)
    } catch {
      $fallback = "I could not verify live official government scheme information right now.`nTo avoid giving outdated or expired scheme advice, please check these official places:`n- myscheme.gov.in`n- Tripura / your state Agriculture, Animal Resources, Fisheries, Dairy or Horticulture department portal`n- nearest Krishi Vigyan Kendra, agriculture office, livestock office, fishery office or CSC`nAsk again in a moment, or include the exact scheme name and state so I can try a narrower live lookup."
      $json = @{ reply = $fallback; sources = @() } | ConvertTo-Json
      $buffer = [Text.Encoding]::UTF8.GetBytes($json)
      $response.StatusCode = 200
      $response.OutputStream.Write($buffer, 0, $buffer.Length)
    }
    $response.Close()
    continue
  }

  $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
  if ($requestPath -eq "/") { $requestPath = "/index.html" }

  $relative = $requestPath.TrimStart("/") -replace "/", [IO.Path]::DirectorySeparatorChar
  $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative))

  $relativeToRoot = [IO.Path]::GetRelativePath($root, $file)
  if ($relativeToRoot.StartsWith("..") -or [IO.Path]::IsPathRooted($relativeToRoot) -or -not [IO.File]::Exists($file)) {
    $buffer = [Text.Encoding]::UTF8.GetBytes("Not found")
    $response.StatusCode = 404
    $response.ContentType = "text/plain; charset=utf-8"
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.Close()
    continue
  }

  $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
  $response.StatusCode = 200
  $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
  $bytes = [IO.File]::ReadAllBytes($file)
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}
