FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY backend/pom.xml backend/pom.xml
COPY backend/src backend/src
COPY index.html login.html dashboard.html ads.txt sitemap.xml ./
COPY assets assets
COPY css css
COPY js js

RUN mvn -f backend/pom.xml -DskipTests package \
    && cp backend/target/fintech-api.jar /workspace/app.jar

FROM eclipse-temurin:17-jre
WORKDIR /app

COPY --from=build /workspace/app.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
