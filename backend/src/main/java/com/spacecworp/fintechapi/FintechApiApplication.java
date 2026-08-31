package com.spacecworp.fintechapi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class FintechApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(FintechApiApplication.class, args);
    }
}
