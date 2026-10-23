@REM Licensed to the Apache Software Foundation (ASF) under one
@REM or more contributor license agreements.  See the NOTICE file
@REM distributed with this work for additional information
@REM regarding copyright ownership.  The ASF licenses this file
@REM to you under the Apache License, Version 2.0 (the
@REM "License"); you may not use this file except in compliance
@REM with the License.  You may obtain a copy of the License at
@REM
@REM   https://www.apache.org/licenses/LICENSE-2.0
@REM
@REM Unless required by applicable law or agreed to in writing,
@REM software distributed under the License is distributed on an
@REM "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
@REM KIND, either express or implied.  See the License for the
@REM specific language governing permissions and limitations
@REM under the License.

@echo off
setlocal

set WRAPPER_DIR=%~dp0
set MAVEN_WRAPPER_PROPERTIES=%WRAPPER_DIR%.mvn\wrapper\maven-wrapper.properties

for /f "tokens=1,2 delims==" %%A in (%MAVEN_WRAPPER_PROPERTIES%) do (
    if "%%A"=="distributionUrl" set DISTRIBUTION_URL=%%B
)

set MAVEN_VERSION=3.9.9
set MAVEN_HOME_DIR=%USERPROFILE%\.m2\wrapper\dists\apache-maven-%MAVEN_VERSION%
set MVN_CMD=%MAVEN_HOME_DIR%\apache-maven-%MAVEN_VERSION%\bin\mvn.cmd

if not exist "%MVN_CMD%" (
    echo Downloading Apache Maven %MAVEN_VERSION%...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ErrorActionPreference = 'Stop'; " ^
        "$dest = '%MAVEN_HOME_DIR%'; " ^
        "New-Item -ItemType Directory -Force -Path $dest | Out-Null; " ^
        "$zip = Join-Path $dest 'maven.zip'; " ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
        "Invoke-WebRequest -Uri 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/%MAVEN_VERSION%/apache-maven-%MAVEN_VERSION%-bin.zip' -OutFile $zip; " ^
        "Expand-Archive -Path $zip -DestinationPath $dest -Force; " ^
        "Remove-Item $zip -Force;"
)

call "%MVN_CMD%" %*
endlocal

