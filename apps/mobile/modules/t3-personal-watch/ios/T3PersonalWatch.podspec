Pod::Spec.new do |s|
  s.name = 'T3PersonalWatch'
  s.version = '1.0.0'
  s.summary = 'Private Watch gateway provisioning over WatchConnectivity.'
  s.author = 'T3 Tools'
  s.homepage = 'https://t3tools.com'
  s.platform = :ios, '18.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'WatchConnectivity'
end
