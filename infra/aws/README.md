# AWS deployment

This stack creates two independent public Versus nodes in separate AWS
regions. Each host gets its own VPC, Elastic IP, Route 53 record, encrypted EBS
volume, SSM-managed instance role, CloudWatch status alarm, and Caddy-managed
TLS endpoint.

Terraform never creates, reads, or stores transport keys, rain-attestor keys, optional graduation-keeper keys, or RPC credentials. They are created or obtained separately and written directly to each region's SSM Parameter Store as `SecureString` values. The instance role can read only its own required parameters and the optional keeper parameter when enabled.

## Prerequisites

- Terraform 1.6 or newer
- AWS CLI authenticated with a temporary profile or AWS IAM Identity Center
- An existing public Route 53 hosted zone
- A public, immutable Git tag or commit for this repository
- An S3 state bucket with versioning, encryption, public access blocked, and
  `use_lockfile = true`

Do not use an AWS root user or paste access keys, node keys, or Terraform state
into chat.

## 1. Prepare immutable application code

Push the relay repository and create a release tag. Put that tag or full commit
SHA in `repository_ref`; production deliberately rejects `main`.

## 2. Create relay identities locally

Generate two distinct 32-byte hex keys. Use the repository identity command to
derive each stable PeerID, then place the opposite PeerID in each relay's
`static_peer` multiaddress.

```powershell
$keyA = -join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }))
$env:VERSUS_WAKU_NODE_KEY = $keyA
npm run identity
```

Repeat for relay B. Store the keys directly in SSM in their respective regions:

```powershell
aws ssm put-parameter --region us-east-1 --name /versus/production/relay-a/node-key --type SecureString --value $keyA --overwrite
aws ssm put-parameter --region us-west-2 --name /versus/production/relay-b/node-key --type SecureString --value $keyB --overwrite
Remove-Variable keyA,keyB
Remove-Item Env:VERSUS_WAKU_NODE_KEY -ErrorAction SilentlyContinue
```

Generate separate non-funded attestor identities with `npm run attestor`. Store each private key and each node's Base RPC URL in the corresponding `rain-attestor-key` and `base-rpc-url` SecureString parameters shown by `terraform.tfvars.example`. Record the two public attestor addresses for the Cypher deployment manifest. Never reuse a Cypher wallet or Waku transport key as an attestor.

Graduation is permissionless and requires no keeper. To opt a host in, run `npm run keeper`, place that separate key in its `graduation-keeper-key` SecureString, fund only the printed address with a small Base gas balance, set `graduation_keeper_enabled = true`, and uncomment that host's parameter name. The IAM policy includes the fourth parameter only for an enabled host. Do not enable both operator hosts merely for symmetry; multiple keepers can race and a losing transaction may consume gas.

Shell history and terminal recording should be disabled while inserting keys.
For stricter handling, use an interactive no-echo prompt or a secret-management
workflow rather than putting values directly on a command line.

## 3. Configure state and variables

Copy `backend.hcl.example` to `backend.hcl` and
`terraform.tfvars.example` to `terraform.tfvars`. Both local files are ignored.
Set the hosted zone, immutable repository ref, domains, regions, the three required parameter names per node, any explicitly enabled keeper parameter, opposite relay PeerIDs, canonical Arena address, deployment start block, polling interval, confirmations, and daily RPC credit budget.

## 4. Apply

```powershell
terraform -chdir=infra/aws init -backend-config=backend.hcl
terraform -chdir=infra/aws fmt -check -recursive
terraform -chdir=infra/aws validate
terraform -chdir=infra/aws plan -out=production.tfplan
terraform -chdir=infra/aws apply production.tfplan
```

The instances bootstrap Docker, check out the immutable ref, retrieve only their
own secrets, write a root-readable `.env`, and start the Compose stack through
systemd. No inbound SSH is opened by default; use the output SSM commands.

## 5. Verify

Wait for DNS and Caddy certificate issuance, then verify both hosts:

```powershell
aws ssm start-session --region us-east-1 --target i-REPLACE
sudo systemctl status versus-waku-relay
cd /opt/versus-waku-relay
sudo npm run health
```

Confirm each node reports the other as a peer, the verifier cursor advances, projected and actual credits remain under budget, WSS works from outside AWS, and the desktop client receives both a signed postcard and a signed canonical rain window through both bootstrap domains. An enabled keeper must additionally report its expected public signer and canonical Arena-derived contract wiring without exposing its key.

## Updating

Create a new immutable tag, update `repository_ref`, and apply. Terraform does
not replace a running instance solely because user data changed, preserving its
local Store database. Apply the release on each host through SSM, or replace
hosts deliberately during a maintenance window. Automated rolling deployment
can be added after the first production behavior is measured.

## Recovery

Transport, attestor, and optional keeper identities live in SSM and message history is intentionally bounded. The verifier cursor and graduation journal in `/var/lib/versus-node` should be preserved. Losing the rain cursor is recoverable by restarting from an earlier canonical block because clients deduplicate replay. Losing a pending graduation journal requires checking the keeper address's transaction history and current class before re-enabling it. Terraform state and SSM parameters remain critical control-plane assets.
