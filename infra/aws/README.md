# AWS deployment

This stack creates two independent public nwaku relay hosts in separate AWS
regions. Each host gets its own VPC, Elastic IP, Route 53 record, encrypted EBS
volume, SSM-managed instance role, CloudWatch status alarm, and Caddy-managed
TLS endpoint.

Terraform never creates, reads, or stores a relay node private key. Each key is
created locally and written directly to that region's SSM Parameter Store as a
`SecureString`. The instance role can read only its own parameter.

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

Shell history and terminal recording should be disabled while inserting keys.
For stricter handling, use an interactive no-echo prompt or a secret-management
workflow rather than putting values directly on a command line.

## 3. Configure state and variables

Copy `backend.hcl.example` to `backend.hcl` and
`terraform.tfvars.example` to `terraform.tfvars`. Both local files are ignored.
Set the hosted zone, immutable repository ref, domains, regions, parameter
names, and opposite relay PeerIDs.

## 4. Apply

```powershell
terraform -chdir=infra/aws init -backend-config=backend.hcl
terraform -chdir=infra/aws fmt -check -recursive
terraform -chdir=infra/aws validate
terraform -chdir=infra/aws plan -out=production.tfplan
terraform -chdir=infra/aws apply production.tfplan
```

The instances bootstrap Docker, check out the immutable ref, retrieve only their
own key, write a root-readable `.env`, and start the Compose stack through
systemd. No inbound SSH is opened by default; use the output SSM commands.

## 5. Verify

Wait for DNS and Caddy certificate issuance, then verify both hosts:

```powershell
aws ssm start-session --region us-east-1 --target i-REPLACE
sudo systemctl status versus-waku-relay
cd /opt/versus-waku-relay
sudo npm run health
```

Confirm each node reports the other as a peer, WSS works from outside AWS, and
the desktop client can publish and receive a signed test postcard through both
bootstrap domains.

## Updating

Create a new immutable tag, update `repository_ref`, and apply. Terraform does
not replace a running instance solely because user data changed, preserving its
local Store database. Apply the release on each host through SSM, or replace
hosts deliberately during a maintenance window. Automated rolling deployment
can be added after the first production behavior is measured.

## Recovery

The relay identity lives in SSM and message history is intentionally bounded and
disposable. Replacing an instance preserves the PeerID as long as the same SSM
key is retained. Terraform state and SSM parameters are the critical control
plane assets; back them up and restrict access accordingly.

