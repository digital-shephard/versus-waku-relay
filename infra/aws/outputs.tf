output "relay_a" {
  value = module.relay_a.summary
}

output "relay_b" {
  value = module.relay_b.summary
}

output "desktop_bootstrap_domains" {
  description = "Domains whose final WSS multiaddresses are printed by npm run health on each host."
  value       = [var.relay_a.domain, var.relay_b.domain]
}

output "session_commands" {
  value = [
    "aws ssm start-session --region ${var.relay_a.region} --target ${module.relay_a.instance_id}",
    "aws ssm start-session --region ${var.relay_b.region} --target ${module.relay_b.instance_id}",
  ]
}
