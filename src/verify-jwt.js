import { jwtVerify, importX509 } from 'jose';

const jwt = "PASTE_YOUR_JWT_HERE";

async function verifyJWT() {
  try {
    // Step 1: Decode header to get x5c
    const [headerB64] = jwt.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());

    const x5c = header.x5c;
    if (!x5c || x5c.length === 0) {
      throw new Error("No x5c certificate found in JWT");
    }

    // Step 2: Convert x5c to PEM
    const cert = x5c[0];
    const pem = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;

    // Step 3: Import public key
    const publicKey = await importX509(pem, header.alg);

    // Step 4: Verify JWT
    const { payload } = await jwtVerify(jwt, publicKey);

    console.log("✅ JWT Verified Successfully");
    console.log("Payload:", payload);

    // Step 5: Extract isOver18
    const isOver18 = payload?.vc?.credentialSubject?.isOver18;

    console.log("isOver18:", isOver18);

    return { payload, isOver18 };

  } catch (err) {
    console.error("❌ JWT Verification Failed:", err.message);
  }
}

verifyJWT();