FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN mvn -f backend/pom.xml -DskipTests package \
    && jar_path="$(find backend/target -maxdepth 1 -type f -name '*.jar' ! -name '*.jar.original' | head -n 1)" \
    && test -n "$jar_path" \
    && cp "$jar_path" /workspace/app.jar

FROM eclipse-temurin:17-jre
WORKDIR /app

COPY --from=build /workspace/app.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
