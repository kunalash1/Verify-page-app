import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { importX509, jwtVerify } from "jose"

const BASE_URL = "/verify"

const VERIFY_BASE_URL =
  import.meta.env.VITE_VERIFY_BASE_URL || ""

const CLIENT_ID =
  import.meta.env.VITE_CLIENT_ID || ""

const NONCE_EXPIRY_MINUTES = Number(import.meta.env.VITE_NONCE_EXPIRY_MINUTES || 3)
const NONCE_EXPIRY_MS = NONCE_EXPIRY_MINUTES * 60 * 1000


function generateUUID() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function VerifyQR() {

  const canvasRef = useRef(null)

  const [message, setMessage] = useState("")
  const [messageColor, setMessageColor] = useState("red")
  const [showQR, setShowQR] = useState(false)
  const [showCodeVerification, setShowCodeVerification] = useState(false)
  const [verificationNonce, setVerificationNonce] = useState("")
  const [ageVerificationCode, setAgeVerificationCode] = useState("")
  const [nonceCreatedAt, setNonceCreatedAt] = useState(0)
  const [now, setNow] = useState(Date.now())

  function decodeBase64Url(value) {
    const withBase64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = withBase64.padEnd(Math.ceil(withBase64.length / 4) * 4, "=")
    return atob(padded)
  }

  function extractAgeOver18(payload) {
    return (
      payload?.ageOver18 ??
      payload?.isOver18 ??
      payload?.credentialSubject?.ageOver18 ??
      payload?.credentialSubject?.isOver18 ??
      payload?.vc?.credentialSubject?.ageOver18 ??
      payload?.vc?.credentialSubject?.isOver18
    )
  }

  function normalizeToBoolean(value) {
    if (typeof value === "boolean") {
      return value
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()
      if (normalized === "true") {
        return true
      }
      if (normalized === "false") {
        return false
      }
    }
    return undefined
  }

  function extractNonce(payload) {
    return (
      payload?.c_nonce ??
      payload?.nonce ??
      payload?.vp_nonce ??
      payload?.credentialSubject?.nonce ??
      payload?.vc?.nonce
    )
  }

  function isNonceExpired() {
    if (!nonceCreatedAt) {
      return true
    }
    return now - nonceCreatedAt > NONCE_EXPIRY_MS
  }

  function remainingSeconds() {
    if (!nonceCreatedAt) {
      return 0
    }
    const remaining = NONCE_EXPIRY_MS - (now - nonceCreatedAt)
    return Math.max(0, Math.ceil(remaining / 1000))
  }

  useEffect(() => {
    if (!showCodeVerification || !nonceCreatedAt) {
      return undefined
    }

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [showCodeVerification, nonceCreatedAt])


  async function createVPRequest() {

    const body = {
      clientId: CLIENT_ID,
      nonce: Date.now().toString(),
      acceptVPWithoutHolderProof: true,
      presentationDefinition: {
        id: generateUUID(),
        purpose: "Self authentication",
        input_descriptors: [
          {
            id: "id card credential",
            format: {
              ldp_vc: {
                proof_type: ["Ed25519Signature2020"]
              }
            },
            constraints: {
              fields: [
                {
                  path: ["$.type"],
                  filter: {
                    type: "string",
                    pattern: "ECACredential"
                  }
                }
              ]
            }
          }
        ]
      }
    }

    const res = await fetch(`${BASE_URL}/v1/verify/vp-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error("Failed to create VP request")
    }

    return res.json()
  }


  async function pollStatus(requestId, txnId) {

    while (true) {

      const statusRes = await fetch(
        `${BASE_URL}/v1/verify/vp-request/${requestId}/status`
      )

      const status = await statusRes.json()

      if (status.status === "EXPIRED") {
        setShowQR(false)
        setMessageColor("red")
        setMessage("QR expired")
        return
      }

      if (status.status === "VP_SUBMITTED") {

        const resultRes = await fetch(
          `${BASE_URL}/v1/verify/vp-result-verify-age/${txnId}`
        )

        const result = await resultRes.json()

        setShowQR(false)

        if (result.verificationStatus !== "SUCCESS") {
          setMessageColor("red")
          setMessage("VC is not valid")
          return
        }

        if (result.vpVerificationStatus !== "SUCCESS") {
          setMessageColor("red")
          setMessage("VC is not valid")
          return
        }

        if (result.isAdult === false) {
          setMessageColor("red")
          setMessage("Access denied.")
          return
        }

        if (result.verificationStatus === "SUCCESS" && result.isAdult === true) {
          setMessageColor("green")
          setMessage("18+ Verified")
          return
        }
      }

      await new Promise((r) => setTimeout(r, 1000))
    }
  }


  const startQRVerification = async () => {

    try {

      setMessage("")
      setShowQR(true)

      const data = await createVPRequest()

      const requestId = data.requestId
      const txnId = data.transactionId

      const requestUri =
        `${VERIFY_BASE_URL}/v1/verify/vp-request/${requestId}`

      const deepLink =
        `openid4vp://authorize?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&request_uri=${encodeURIComponent(requestUri)}`

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, deepLink, { width: 260 })
      }

      pollStatus(requestId, txnId)

    } catch (err) {

      console.error(err)
      setShowQR(false)
      setMessageColor("red")
      setMessage("Verification failed")

    }
  }


  const openWalletVerification = async () => {

    try {

      setMessage("")
      setShowQR(false)

      const data = await createVPRequest()

      const requestId = data.requestId
      const txnId = data.transactionId

      const requestUri =
        `${VERIFY_BASE_URL}/v1/verify/vp-request/${requestId}`

      const deepLink =
        `openid4vp://authorize?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&request_uri=${encodeURIComponent(requestUri)}`

      window.location.href = deepLink

      pollStatus(requestId, txnId)

    } catch (err) {

      console.error(err)
      setMessageColor("red")
      setMessage("Verification failed")

    }
  }

  const openCodeVerification = () => {
    const createdAt = Date.now()
    const nonce = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0")
    setShowQR(false)
    setMessage("")
    setShowCodeVerification(true)
    setAgeVerificationCode("")
    setVerificationNonce(nonce)
    setNonceCreatedAt(createdAt)
    setNow(createdAt)
  }

  const verifyAgeFromCode = async () => {
    try {
      // Some wallets/tools include a trailing "~" when copying. Strip it before verification.
      const jwt = ageVerificationCode.trim().replace(/~+$/, "")
      if (!jwt || !verificationNonce) {
        return
      }
      if (isNonceExpired()) {
        setMessageColor("red")
        setMessage("Code expired. Please generate a new code.")
        return
      }

      const [headerB64] = jwt.split(".")
      if (!headerB64) {
        throw new Error("Invalid code format")
      }

      const header = JSON.parse(decodeBase64Url(headerB64))
      const cert = header?.x5c?.[0]
      if (!cert || !header?.alg) {
        throw new Error("Signing certificate not found in JWT header")
      }

      const pem = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`
      const publicKey = await importX509(pem, header.alg)
      const { payload } = await jwtVerify(jwt, publicKey)

      const nonceInJwt = extractNonce(payload)
      if (nonceInJwt !== verificationNonce) {
        throw new Error("verification failed")
      }

      const ageOver18 = normalizeToBoolean(extractAgeOver18(payload))
      if (ageOver18 === true) {
        setMessageColor("green")
        setMessage("18+ Verified")
        return
      }

      setMessageColor("red")
      setMessage("Access denied")
    } catch (err) {
      console.error(err)
      setMessageColor("red")
      setMessage("Verification failed")
    }
  }


  return (
    <div
      style={{
        maxWidth: "420px",
        margin: "auto",
        padding: "20px",
        textAlign: "center",
        fontFamily: "system-ui"
      }}
    >

      <h2 style={{ marginBottom: "25px" }}>
        Age Verification
      </h2>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >

        <button
          onClick={startQRVerification}
          style={{
            padding: "14px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer"
          }}
        >
          Start QR Verification
        </button>

        <button
          onClick={openWalletVerification}
          style={{
            padding: "14px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            background: "#16a34a",
            color: "white",
            cursor: "pointer"
          }}
        >
          Deeplink
        </button>

        <button
          onClick={openCodeVerification}
          style={{
            padding: "14px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            background: "#0f766e",
            color: "white",
            cursor: "pointer"
          }}
        >
          Verify age with code
        </button>

      </div>

      {showCodeVerification && (
        <div
          style={{
            marginTop: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          <div style={{ fontWeight: 600, wordBreak: "break-all" }}>
           {verificationNonce}
          </div>
          <div style={{ fontSize: "13px", color: isNonceExpired() ? "#b91c1c" : "#334155" }}>
            Expires in: {remainingSeconds()}s
          </div>

          <input
            type="text"
            value={ageVerificationCode}
            onChange={(e) => setAgeVerificationCode(e.target.value)}
            placeholder="Enter your age verification code"
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "14px"
            }}
          />

          <button
            onClick={verifyAgeFromCode}
            disabled={!ageVerificationCode.trim() || isNonceExpired()}
            style={{
              padding: "12px",
              fontSize: "15px",
              borderRadius: "8px",
              border: "none",
              background: ageVerificationCode.trim() && !isNonceExpired() ? "#7c3aed" : "#9ca3af",
              color: "white",
              cursor: ageVerificationCode.trim() && !isNonceExpired() ? "pointer" : "not-allowed"
            }}
          >
            Verify your age
          </button>
        </div>
      )}

      <div style={{ marginTop: "30px" }}>
        {showQR && (
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: "100%",
              height: "auto"
            }}
          />
        )}
      </div>

      {message && (
        <h2
          style={{
            color: messageColor,
            fontSize: "28px",
            fontWeight: "bold",
            marginTop: "25px"
          }}
        >
          {message}
        </h2>
      )}

    </div>
  )
}

export default VerifyQR
