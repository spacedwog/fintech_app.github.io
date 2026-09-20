FROM eclipse-temurin:17-jdk AS build
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends maven ca-certificates ca-certificates-java \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN mvn -f backend/pom.xml -DskipTests package \
    && cp backend/target/docker/fintech-api.jar /workspace/app.jar

FROM eclipse-temurin:17-jre
WORKDIR /app

COPY --from=build /workspace/app.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
