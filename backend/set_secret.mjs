import sodium from "libsodium-wrappers";

const [,, owner, repo, token, secretName, secretValue] = process.argv;

await sodium.ready;

const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
});
const pubKeyData = await res.json();
const { key, key_id } = pubKeyData;
if (!key) {
  console.error("No se pudo obtener la clave pública:", JSON.stringify(pubKeyData));
  process.exit(1);
}

const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
const binSecret = sodium.from_string(secretValue);
const encBytes = sodium.crypto_box_seal(binSecret, binKey);
const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ encrypted_value, key_id }),
});
console.log(secretName, putRes.status);
