// Runtime images download only when selected. Repository dependencies are not
// installed on the host. A custom prepared image may be selected in the UI.
// `build` is the fast feedback loop: compile where the language compiles, and a
// syntax/parse check where it does not, so every runtime has something quicker
// than a full test run.
export const runtimes = {
  node: {label:'JavaScript', image:'node:22-alpine', command:'node --test', build:'find . -name "*.mjs" -o -name "*.js" | xargs -n1 node --check'},
  typescript: {label:'TypeScript', image:'node:24-alpine', command:'node --test', build:'npx --no-install tsc --noEmit'},
  python: {label:'Python', image:'python:3.12-slim', command:'python -m unittest discover -v', build:'python -m compileall -q .'},
  java: {label:'Java (Maven)', image:'maven:3.9-eclipse-temurin-21', command:'mvn -o test', build:'mvn -o -q compile'},
  c: {label:'C', image:'gcc:14', command:'make test', build:'make'},
  cpp: {label:'C++', image:'gcc:14', command:'make test', build:'make'},
  csharp: {label:'C# / .NET', image:'mcr.microsoft.com/dotnet/sdk:8.0', command:'dotnet test --no-restore', build:'dotnet build --no-restore'},
  go: {label:'Go', image:'golang:1.24', command:'go test ./...', build:'go build ./...'},
  rust: {label:'Rust', image:'rust:1', command:'cargo test --offline', build:'cargo build --offline'},
  ruby: {label:'Ruby', image:'ruby:3.3', command:'ruby -Itest -e \'Dir["test/**/*_test.rb"].each { |f| require_relative f }\'', build:'find . -name "*.rb" | xargs -n1 ruby -c'},
  php: {label:'PHP', image:'php:8.3-cli', command:'php vendor/bin/phpunit', build:'find . -name "*.php" | xargs -n1 php -l'},
  swift: {label:'Swift', image:'swift:6.0', command:'swift test --skip-update', build:'swift build --skip-update'},
  r: {label:'R', image:'r-base:4.4.3', command:'Rscript -e \'testthat::test_dir("tests/testthat")\'', build:'Rscript -e \'invisible(lapply(list.files(pattern="[.][Rr]$", recursive=TRUE), parse))\''},
  elixir: {label:'Elixir', image:'elixir:1.18', command:'mix test --no-deps-check', build:'mix compile --no-deps-check'},
  perl: {label:'Perl', image:'perl:5.40', command:'prove -r t', build:'find . -name "*.pl" -o -name "*.pm" | xargs -n1 perl -c'},
  bash: {label:'Bash', image:'bash:5.2', command:'bash test.sh', build:'find . -name "*.sh" | xargs -n1 bash -n'}
};
export function detectRuntime(names) {
  const checks = [['Cargo.toml','rust'],['go.mod','go'],['pom.xml','java'],['mix.exs','elixir'],['Package.swift','swift'],['composer.json','php'],['Gemfile','ruby'],['tsconfig.json','typescript'],['package.json','node'],['pyproject.toml','python'],['setup.py','python']];
  for (const [file,id] of checks) if(names.includes(file))return id;
  const suffixes = [['.csproj','csharp'],['.cpp','cpp'],['.c','c'],['.py','python'],['.java','java'],['.rb','ruby'],['.php','php'],['.ts','typescript'],['.R','r'],['.pl','perl']];
  return suffixes.find(([suffix]) => names.some(name=>name.endsWith(suffix)))?.[1] || 'node';
}
