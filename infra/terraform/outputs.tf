output "instance_id" {
  description = "EC2 instance identifier."
  value       = aws_instance.k3s.id
}

output "public_ip" {
  description = "Current public IPv4 address of the k3s node."
  value       = aws_instance.k3s.public_ip
}

output "api_url" {
  description = "PulseOps NodePort URL, restricted by the security group."
  value       = "http://${aws_instance.k3s.public_ip}:30080"
}

output "ssh_command" {
  description = "Command used to access the Ubuntu instance."
  value       = "ssh -i ${trimsuffix(pathexpand(var.public_key_path), ".pub")} ubuntu@${aws_instance.k3s.public_ip}"
}

output "ssh_private_key_path" {
  description = "Local private key used by the deployment scripts."
  value       = trimsuffix(pathexpand(var.public_key_path), ".pub")
}
